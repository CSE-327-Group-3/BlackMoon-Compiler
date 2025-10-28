import asyncio
import tempfile
import os
import sys
import uuid
import subprocess
import time
import logging
from pathlib import Path
from fastapi import WebSocket
from typing import Optional, List

logger = logging.getLogger(__name__)

class TerminalHandler:
    """Handler for WebSocket terminal with interactive code execution"""
    
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.current_process: Optional[asyncio.subprocess.Process] = None
        self.temp_file: Optional[Path] = None
        self.container_name: Optional[str] = None
        self.input_queue = asyncio.Queue()
        self.execution_task: Optional[asyncio.Task] = None
        self._io_tasks: List[asyncio.Task] = []
        
        # Configuration
        self.docker_memory = "256m"
        self.docker_cpus = "0.5"
        self.docker_timeout = 30
        self.max_output_size = 1048576  # 1MB
        self.output_size = 0
        self.execution_start_time = 0
    
    async def handle_message(self, message: str):
        """Handle incoming WebSocket messages"""
        try:
            if message.startswith("RUN "):
                parts = message.split(" ", 2)
                if len(parts) >= 3:
                    language = parts[1].lower()
                    code = parts[2]
                    await self.run_code(language, code)
            
            elif message.startswith("INPUT "):
                input_data = message[6:]  # Remove "INPUT " prefix
                await self._handle_input_command(input_data)
            
            elif message == "STOP":
                await self.stop_execution()
            
        except Exception as e:
            logger.error(f"Message handling error: {e}")
            await self._send_message(f"❌ Error: {str(e)}\n")
    
    async def run_code(self, language: str, code: str):
        """Run code in Docker container with interactive I/O"""
        try:
            # Stop any existing execution
            if self.current_process or (self.execution_task and not self.execution_task.done()):
                await self.stop_execution()
            
            # Check Docker
            if not await self._check_docker():
                return
            
            # Setup
            self.temp_file = self._create_temp_file(language, code)
            self.container_name = f"bm-{uuid.uuid4().hex[:12]}"
            
            await self._send_message("🚀 Starting execution...\n")
            
            self.execution_start_time = time.time()
            self.output_size = 0
            
            # Build Docker command with interactive mode
            docker_command = self._build_docker_command(language, self.temp_file)
            
            creation_flags = 0
            if sys.platform == 'win32':
                creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP
            
            # Start process with stdin, stdout, stderr
            self.current_process = await asyncio.create_subprocess_exec(
                *docker_command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=creation_flags
            )
            
            # Start I/O handling tasks
            self._io_tasks = [
                asyncio.create_task(self._handle_stdout()),
                asyncio.create_task(self._handle_stderr()),
                asyncio.create_task(self._handle_stdin()),
                asyncio.create_task(self._monitor_execution())
            ]
            
            # Run execution supervisor
            self.execution_task = asyncio.create_task(self._run_execution())
        
        except Exception as e:
            logger.error(f"Execution error: {e}")
            await self._send_message(f"❌ Execution failed: {str(e)}\n")
            await self._cleanup_execution()
    
    async def _run_execution(self):
        """Wait for execution tasks to finish"""
        try:
            if self._io_tasks:
                await asyncio.gather(*self._io_tasks, return_exceptions=True)
        except Exception as e:
            logger.error(f"Execution supervisor error: {e}")
        finally:
            await self._cleanup_execution()
    
    async def _handle_input_command(self, input_data: str):
        """Handle user input from frontend"""
        try:
            if not self.current_process:
                logger.warning("No running process to send input to")
                return
            
            if self.current_process.returncode is not None:
                logger.warning(f"Process already terminated with code {self.current_process.returncode}")
                return
            
            logger.info(f"Queueing input: {repr(input_data)}")
            await self.input_queue.put(input_data + "\n")
        
        except Exception as e:
            logger.error(f"Input handling error: {e}")
            await self._send_message(f"❌ Input error: {str(e)}\n")
    
    async def _handle_stdout(self):
        """Handle stdout from Docker process"""
        try:
            while True:
                if not self.current_process or not self.current_process.stdout:
                    break
                
                byte = await self.current_process.stdout.read(1)
                if not byte:
                    break
                
                try:
                    char = byte.decode('utf-8')
                    await self._send_message(char)
                    self.output_size += len(byte)
                    
                    if self.output_size > self.max_output_size:
                        await self._send_message("\n⚠️ Output size limit reached\n")
                        await self.stop_execution()
                        break
                except UnicodeDecodeError:
                    pass
        
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"stdout handler error: {e}")
    
    async def _handle_stderr(self):
        """Handle stderr from Docker process"""
        try:
            while True:
                if not self.current_process or not self.current_process.stderr:
                    break
                
                byte = await self.current_process.stderr.read(1)
                if not byte:
                    break
                
                try:
                    char = byte.decode('utf-8')
                    await self._send_message(char)
                    self.output_size += len(byte)
                    
                    if self.output_size > self.max_output_size:
                        await self._send_message("\n⚠️ Output size limit reached\n")
                        await self.stop_execution()
                        break
                except UnicodeDecodeError:
                    pass
        
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"stderr handler error: {e}")
    
    async def _handle_stdin(self):
        """Handle stdin to Docker process"""
        try:
            while True:
                if not self.current_process or not self.current_process.stdin:
                    break
                
                if self.current_process.returncode is not None:
                    break
                
                try:
                    input_data = await asyncio.wait_for(
                        self.input_queue.get(),
                        timeout=0.5
                    )
                    
                    self.current_process.stdin.write(input_data.encode('utf-8'))
                    await self.current_process.stdin.drain()
                
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    logger.error(f"stdin write error: {e}")
                    break
        
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"stdin handler error: {e}")
    
    async def _monitor_execution(self):
        """Monitor execution time and enforce timeout"""
        try:
            await asyncio.wait_for(
                self.current_process.wait(),
                timeout=self.docker_timeout
            )
            
            exit_code = self.current_process.returncode
            execution_time = time.time() - self.execution_start_time
            
            if exit_code == 0:
                await self._send_message(f"\n✅ Execution completed in {execution_time:.2f}s\n")
            else:
                await self._send_message(f"\n⚠️ Process exited with code {exit_code}\n")
        
        except asyncio.TimeoutError:
            await self._send_message(f"\n⏱️ Execution timeout ({self.docker_timeout}s)\n")
            await self.stop_execution()
        except Exception as e:
            logger.error(f"Monitor execution error: {e}")
    
    def _create_temp_file(self, language: str, code: str) -> Path:
        """Create temporary file for code"""
        suffix_map = {
            "python": ".py",
            "c": ".c",
            "cpp": ".cpp",
            "c++": ".cpp",
            "java": ".java",
            "javascript": ".js",
            "go": ".go",
            "rust": ".rs"
        }
        
        suffix = suffix_map.get(language, ".txt")
        fd, temp_path = tempfile.mkstemp(suffix=suffix, text=True)
        
        try:
            os.write(fd, code.encode('utf-8'))
        finally:
            os.close(fd)
        
        os.chmod(temp_path, 0o644)
        return Path(temp_path)
    
    def _build_docker_command(self, language: str, temp_file: Path) -> List[str]:
        """Build Docker command with interactive mode"""
        mount_path = str(temp_file.resolve())
        
        base_command = [
            "docker", "run",
            "--rm",
            "-i",  # Interactive mode for stdin
            f"--memory={self.docker_memory}",
            f"--cpus={self.docker_cpus}",
            "--network=none",
            "--ulimit", "nproc=32",
            "--name", self.container_name
        ]
        
        if language == "python":
            return base_command + [
                "-v", f"{mount_path}:/code.py:ro",
                "python:3.11-slim",
                "python", "-u", "/code.py"
            ]
        
        elif language == "c":
            return base_command + [
                "-v", f"{mount_path}:/code.c:ro",
                "gcc:latest",
                "sh", "-c",
                "gcc /code.c -o /tmp/program && /tmp/program"
            ]
        
        elif language in ["cpp", "c++"]:
            return base_command + [
                "-v", f"{mount_path}:/code.cpp:ro",
                "gcc:latest",
                "sh", "-c",
                "g++ /code.cpp -o /tmp/program && /tmp/program"
            ]
        
        elif language == "java":
            return base_command + [
                "-v", f"{mount_path}:/code.java:ro",
                "openjdk:17-slim",
                "sh", "-c",
                "javac /code.java -d /tmp && java -cp /tmp Main"
            ]
        
        elif language == "javascript":
            return base_command + [
                "-v", f"{mount_path}:/code.js:ro",
                "node:18-alpine",
                "node", "/code.js"
            ]
        
        elif language == "go":
            return base_command + [
                "-v", f"{mount_path}:/code.go:ro",
                "golang:1.21-alpine",
                "sh", "-c",
                "cd /tmp && cp /code.go . && go run code.go"
            ]
        
        elif language == "rust":
            return base_command + [
                "-v", f"{mount_path}:/code.rs:ro",
                "rust:1.75-alpine",
                "sh", "-c",
                "rustc /code.rs -o /tmp/program && /tmp/program"
            ]
        
        else:
            raise ValueError(f"Unsupported language: {language}")
    
    async def _check_docker(self) -> bool:
        """Check if Docker is available"""
        try:
            result = await asyncio.create_subprocess_exec(
                "docker", "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await result.wait()
            return result.returncode == 0
        except FileNotFoundError:
            await self._send_message("❌ Docker not found. Please install Docker Desktop.\n")
            return False
        except Exception as e:
            await self._send_message(f"❌ Docker check failed: {str(e)}\n")
            return False
    
    async def stop_execution(self):
        """Stop current execution"""
        if self.container_name:
            try:
                proc = await asyncio.create_subprocess_exec(
                    "docker", "rm", "-f", self.container_name,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await proc.wait()
            except Exception as e:
                logger.warning(f"Failed to stop container: {e}")
        
        if self.current_process:
            try:
                self.current_process.terminate()
                await asyncio.sleep(0.5)
                if self.current_process.returncode is None:
                    self.current_process.kill()
            except Exception as e:
                logger.error(f"Stop error: {e}")
        
        if self.execution_task:
            try:
                await asyncio.wait_for(self.execution_task, timeout=5)
            except asyncio.TimeoutError:
                logger.warning("Execution task did not finish within timeout")
            except Exception as e:
                logger.error(f"Error awaiting execution task: {e}")
        
        await self._send_message("\n🛑 Execution stopped\n")
    
    async def _cleanup_execution(self):
        """Cleanup after execution"""
        if self.current_process and self.current_process.stdin:
            try:
                self.current_process.stdin.close()
            except:
                pass
        
        if self.temp_file and self.temp_file.exists():
            try:
                self.temp_file.unlink()
            except Exception as e:
                logger.error(f"Temp file cleanup error: {e}")
        
        self.current_process = None
        self.temp_file = None
        self.container_name = None
        self._io_tasks = []
        self.execution_task = None
    
    async def _send_message(self, message: str):
        """Send message to WebSocket"""
        try:
            await self.websocket.send_text(message)
        except Exception as e:
            logger.error(f"WebSocket send error: {e}")
    
    async def cleanup(self):
        """Cleanup resources"""
        await self.stop_execution()
        await self._cleanup_execution()
        logger.info("Terminal handler cleaned up")


