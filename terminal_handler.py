import asyncio
import tempfile
import os
import logging
from pathlib import Path
from fastapi import WebSocket
from typing import Optional

logger = logging.getLogger(__name__)

class TerminalHandler:
    """Handler for WebSocket terminal communication with subprocess execution"""
    
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.current_process: Optional[asyncio.subprocess.Process] = None
        self.temp_file: Optional[Path] = None
    
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
        """Run code using subprocess"""
        try:
            # Stop any existing execution
            if self.current_process:
                await self.stop_execution()
            
            # Create temporary file
            self.temp_file = self._create_temp_file(language, code)
            
            await self._send_message("🚀 Starting execution...\n")
            
            # Execute based on language
            if language == "python":
                await self._run_python()
            elif language == "javascript":
                await self._run_javascript()
            else:
                await self._send_message(f"❌ Unsupported language: {language}\n")
        
        except Exception as e:
            logger.error(f"Run error: {e}")
            await self._send_message(f"❌ Run error: {str(e)}\n")
        finally:
            await self._cleanup_temp_file()
    
    def _create_temp_file(self, language: str, code: str) -> Path:
        """Create temporary file for code"""
        suffix_map = {
            "python": ".py",
            "javascript": ".js",
            "c": ".c",
            "cpp": ".cpp",
            "java": ".java"
        }
        
        suffix = suffix_map.get(language, ".txt")
        fd, temp_path = tempfile.mkstemp(suffix=suffix, text=True)
        
        try:
            os.write(fd, code.encode('utf-8'))
        finally:
            os.close(fd)
        
        os.chmod(temp_path, 0o644)
        return Path(temp_path)
    
    async def _run_python(self):
        """Run Python code"""
        try:
            self.current_process = await asyncio.create_subprocess_exec(
                "python", "-u", str(self.temp_file),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            # Read output
            stdout, stderr = await self.current_process.communicate()
            
            if stdout:
                await self._send_message(stdout.decode('utf-8'))
            if stderr:
                await self._send_message(stderr.decode('utf-8'))
            
            if self.current_process.returncode == 0:
                await self._send_message("\n✅ Execution completed\n")
            else:
                await self._send_message(f"\n⚠️ Process exited with code {self.current_process.returncode}\n")
        
        except Exception as e:
            logger.error(f"Python execution error: {e}")
            await self._send_message(f"❌ Execution failed: {str(e)}\n")
    
    async def _run_javascript(self):
        """Run JavaScript code"""
        try:
            self.current_process = await asyncio.create_subprocess_exec(
                "node", str(self.temp_file),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await self.current_process.communicate()
            
            if stdout:
                await self._send_message(stdout.decode('utf-8'))
            if stderr:
                await self._send_message(stderr.decode('utf-8'))
            
            if self.current_process.returncode == 0:
                await self._send_message("\n✅ Execution completed\n")
            else:
                await self._send_message(f"\n⚠️ Process exited with code {self.current_process.returncode}\n")
        
        except FileNotFoundError:
            await self._send_message("❌ Node.js not found. Please install Node.js.\n")
        except Exception as e:
            logger.error(f"JavaScript execution error: {e}")
            await self._send_message(f"❌ Execution failed: {str(e)}\n")
    
    async def stop_execution(self):
        """Stop current execution"""
        if self.current_process:
            try:
                self.current_process.terminate()
                await asyncio.sleep(0.5)
                if self.current_process.returncode is None:
                    self.current_process.kill()
                await self._send_message("🛑 Execution stopped\n")
            except Exception as e:
                logger.error(f"Stop error: {e}")
        self.current_process = None
    
    async def _cleanup_temp_file(self):
        """Cleanup temporary file"""
        if self.temp_file and self.temp_file.exists():
            try:
                self.temp_file.unlink()
            except Exception as e:
                logger.error(f"Temp file cleanup error: {e}")
        self.temp_file = None
    
    async def _send_message(self, message: str):
        """Send message to WebSocket"""
        try:
            await self.websocket.send_text(message)
        except Exception as e:
            logger.error(f"WebSocket send error: {e}")
    
    async def cleanup(self):
        """Cleanup resources"""
        await self.stop_execution()
        await self._cleanup_temp_file()
        logger.info("Terminal handler cleaned up")


