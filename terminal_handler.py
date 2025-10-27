import asyncio
import logging
from fastapi import WebSocket
from typing import Optional

logger = logging.getLogger(__name__)

class TerminalHandler:
    """Handler for WebSocket terminal communication"""
    
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.current_process: Optional[asyncio.subprocess.Process] = None
    
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
        """Run code (placeholder for now)"""
        try:
            await self._send_message(f"🚀 Running {language} code...\n")
            await self._send_message(f"Code: {code[:100]}...\n")
            await self._send_message("✅ Execution completed\n")
        except Exception as e:
            logger.error(f"Run error: {e}")
            await self._send_message(f"❌ Run error: {str(e)}\n")
    
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
        else:
            await self._send_message("No running process to stop\n")
    
    async def _send_message(self, message: str):
        """Send message to WebSocket"""
        try:
            await self.websocket.send_text(message)
        except Exception as e:
            logger.error(f"WebSocket send error: {e}")
    
    async def cleanup(self):
        """Cleanup resources"""
        if self.current_process:
            await self.stop_execution()
        logger.info("Terminal handler cleaned up")


