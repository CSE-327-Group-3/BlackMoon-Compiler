import asyncio
import tempfile
import os
import sys
import uuid
import subprocess
import logging
from pathlib import Path
from fastapi import WebSocket
from typing import Optional, List

logger = logging.getLogger(__name__)

class TerminalHandler:
    """Handler for WebSocket terminal with Docker-based code execution"""
    
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.current_process: Optional[asyncio.subprocess.Process] = None
        self.temp_file: Optional[Path] = None
        self.container_name: Optional[str] = None
        
        # Docker resource limits
        self.docker_memory = "256m"
        self.docker_cpus = "0.5"
        self.docker_timeout = 30
    
    async def handle_message(self, message: str):
        """Handle incoming WebSocket messages"""
        try:
            if message.startswith("RUN "):
                parts = message.split(" ", 2)
                if len(parts) >= 3:
                    language = parts[1].lower()
                    code = parts[2]
                    await self.run_code(language, code)
            elif message == "STOP":
                await self.stop_execution()
            else:
                await self._send_message(f"Unknown command: {message}\n")
        except Exception as e:
            logger.error(f"Message handling error: {e}")
            await self._send_message(f"❌ Error: {str(e)}\n")
    
    async def run_code(self, language: str, code: str):
        """Run code in Docker container"""
        try:
            # Stop any existing execution
            if self.current_process:
                await self.stop_execution()
            
            # Check Docker availability
            if not await self._check_docker():
                return
            
            # Create temporary file
            self.temp_file = self._create_temp_file(language, code)
            
            # Generate unique container name
            self.container_name = f"bm-{uuid.uuid4().hex[:12]}"
            
            await self._send_message("🚀 Starting execution in Docker...\n")
            
            # Build and execute Docker command
            docker_command = self._build_docker_command(language, self.temp_file)
            
            # Create process with proper platform handling
            creation_flags = 0
            if sys.platform == 'win32':
                creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP
            
            self.current_process = await asyncio.create_subprocess_exec(
                *docker_command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=creation_flags
            )
            
            # Execute with timeout
            try:
                stdout, stderr = await asyncio.wait_for(
                    self.current_process.communicate(),
                    timeout=self.docker_timeout
                )
                
                if stdout:
                    await self._send_message(stdout.decode('utf-8'))
                if stderr:
                    await self._send_message(stderr.decode('utf-8'))
                
                if self.current_process.returncode == 0:
                    await self._send_message("\n✅ Execution completed\n")
                else:
                    await self._send_message(f"\n⚠️ Process exited with code {self.current_process.returncode}\n")
            
            except asyncio.TimeoutError:
                await self._send_message(f"\n⏱️ Execution timeout ({self.docker_timeout}s)\n")
                await self.stop_execution()
        
        except Exception as e:
            logger.error(f"Run error: {e}")
            await self._send_message(f"❌ Run error: {str(e)}\n")
        finally:
            await self._cleanup_execution()
    
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
        """Build Docker command for code execution"""
        mount_path = str(temp_file.resolve())
        
        base_command = [
            "docker", "run",
            "--rm",
            f"--memory={self.docker_memory}",
            f"--cpus={self.docker_cpus}",
            "--network=none",
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
        # Stop Docker container
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
        
        # Terminate process
        if self.current_process:
            try:
                self.current_process.terminate()
                await asyncio.sleep(0.5)
                if self.current_process.returncode is None:
                    self.current_process.kill()
            except Exception as e:
                logger.error(f"Stop error: {e}")
        
        await self._send_message("🛑 Execution stopped\n")
    
    async def _cleanup_execution(self):
        """Cleanup after execution"""
        if self.temp_file and self.temp_file.exists():
            try:
                self.temp_file.unlink()
            except Exception as e:
                logger.error(f"Temp file cleanup error: {e}")
        
        self.current_process = None
        self.temp_file = None
        self.container_name = None
    
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


