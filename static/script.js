
class BlackMoonCompiler {
    constructor() {
        // Core properties
        this.editor = null;
        this.currentProject = null;
        this.currentFile = null;
        this.openFiles = new Map();
        this.authToken = localStorage.getItem('authToken');
        this.fontSize = this._loadFontSize();
        
        this.init();
    }

    async init() {
        // Check authentication
        if (!this.authToken) {
            window.location.href = '/';
            return;
        }

        // Initialize editor
        this.initEditor();
        
        // Verify token
        await this.verifyToken();
    }

    initEditor() {
        // Initialize Ace Editor with monokai theme
        this.editor = ace.edit("codeEditor");
        this.editor.setTheme("ace/theme/monokai");
        this.editor.session.setMode("ace/mode/python");
        this.editor.setOptions({
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: true,
            showPrintMargin: false,
            fontSize: `${this.fontSize}px`,
            fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
            tabSize: 4,
            useSoftTabs: true,
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            this.editor && this.editor.resize(true);
        });
    }

    _loadFontSize() {
        const stored = parseInt(localStorage.getItem('editorFontSize'), 10);
        return !isNaN(stored) ? Math.min(28, Math.max(10, stored)) : 14;
    }

    async verifyToken() {
        try {
            const response = await fetch('/api/verify', {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            if (!response.ok) {
                this.logout();
            }
        } catch (error) {
            console.error('Token verification failed:', error);
            this.logout();
        }
    }

    logout() {
        localStorage.removeItem('authToken');
        window.location.href = '/';
    }
}

// Initialize when DOM is ready
let compiler;
document.addEventListener('DOMContentLoaded', () => {
    compiler = new BlackMoonCompiler();
});

