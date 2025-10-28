
class BlackMoonCompiler {
    constructor() {
        // Core properties
        this.editor = null;
        this.currentProject = null;
        this.currentFile = null;
        this.openFiles = new Map();
        this.ws = null;
        this.wsConnecting = false;
        this.isRunning = false;
        this.authToken = localStorage.getItem('authToken');
        this.fontSize = this._loadFontSize();
        this.currentFolder = null;
        
        // Terminal properties
        this.xterm = null;
        this.fitAddon = null;
        this.terminalInputBuffer = '';
        this.textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
        this.terminalFontSize = this._loadTerminalFontSize();
        
        this.init();
    }

    async init() {
        // Check authentication
        if (!this.authToken) {
            window.location.href = '/';
            return;
        }

        // Initialize components
        this.initEditor();
        this.initTerminal();
        
        // Load projects
        await this.loadProjects();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Verify token
        await this.verifyToken();
    }

    initEditor() {
        // Initialize Ace Editor
        this.editor = ace.edit("codeEditor");
        this.editor.setTheme("ace/theme/monokai");
        this.editor.session.setMode("ace/mode/python");
        this.editor.setOptions({
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: true,
            enableSnippets: true,
            showPrintMargin: false,
            fontSize: `${this.fontSize}px`,
            fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
            tabSize: 4,
            useSoftTabs: true,
            wrap: false,
            showGutter: true,
            highlightActiveLine: true,
            showInvisibles: false,
        });

        // Keyboard shortcuts
        this.editor.commands.addCommand({
            name: 'save',
            bindKey: {win: 'Ctrl-S', mac: 'Command-S'},
            exec: () => this.saveCurrentFile()
        });

        this.editor.commands.addCommand({
            name: 'run',
            bindKey: {win: 'F5', mac: 'F5'},
            exec: () => this.runCode()
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            this.editor && this.editor.resize(true);
            this.fitTerminal();
        });

        // Update editor mode on language change
        document.getElementById('languageSelect').addEventListener('change', (e) => {
            this.setEditorMode(e.target.value);
        });
    }

    initTerminal() {
        if (this.xterm) return;

        const container = document.getElementById('terminal-container');
        if (!container) {
            console.warn('[Terminal] Container not found.');
            return;
        }

        if (typeof Terminal === 'undefined') {
            console.warn('[Terminal] xterm.js not loaded.');
            return;
        }

        // Create xterm instance
        this.xterm = new Terminal({
            convertEol: true,
            cursorBlink: true,
            scrollback: 2000,
            fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
            fontSize: this.terminalFontSize,
            theme: {
                background: '#0c0c0c',
                foreground: '#d1d5db',
                cursor: '#facc15',
                selection: 'rgba(88, 28, 135, 0.35)'
            }
        });

        // Load fit addon for responsive sizing
        try {
            if (window.FitAddon && typeof window.FitAddon.FitAddon === 'function') {
                this.fitAddon = new window.FitAddon.FitAddon();
            } else if (typeof FitAddon !== 'undefined') {
                this.fitAddon = new FitAddon.FitAddon();
            }
            if (this.fitAddon) {
                this.xterm.loadAddon(this.fitAddon);
            }
        } catch (err) {
            console.warn('[Terminal] Failed to load fit addon:', err);
        }

        this.xterm.open(container);
        this.fitTerminal();
        this.focusTerminal();

        // Handle terminal input
        this.xterm.onData((data) => this.handleTerminalData(data));
    }

    fitTerminal() {
        if (this.fitAddon && typeof this.fitAddon.fit === 'function') {
            try {
                this.fitAddon.fit();
            } catch (err) {
                console.debug('[Terminal] fit failed:', err);
            }
        }
    }

    focusTerminal() {
        if (this.xterm && typeof this.xterm.focus === 'function') {
            try {
                this.xterm.focus();
            } catch (_) {}
        }
    }

    handleTerminalData(data) {
        if (!this.xterm) return;

        // Ignore escape sequences for now
        if (data && data.startsWith('\u001b')) {
            return;
        }

        for (const char of data) {
            switch (char) {
                case '\r':
                case '\n': {
                    const payload = this.terminalInputBuffer;
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(`INPUT ${payload}`);
                    }
                    this.terminalInputBuffer = '';
                    this.xterm.write('\r\n');
                    break;
                }
                case '\u0003': { // Ctrl+C
                    this.xterm.write('^C\r\n');
                    this.terminalInputBuffer = '';
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send('STOP');
                    }
                    this.isRunning = false;
                    this.updateRunButton();
                    break;
                }
                case '\u007f': // Backspace
                case '\b': {
                    if (this.terminalInputBuffer.length > 0) {
                        this.terminalInputBuffer = this.terminalInputBuffer.slice(0, -1);
                        this.xterm.write('\b \b');
                    }
                    break;
                }
                default: {
                    if (char >= ' ') {
                        this.terminalInputBuffer += char;
                        this.xterm.write(char);
                    }
                    break;
                }
            }
        }
    }

    clearTerminal() {
        if (this.xterm) {
            this.xterm.clear();
        }
    }

    toggleTerminal() {
        const terminalPanel = document.querySelector('.terminal-panel');
        if (terminalPanel) {
            terminalPanel.classList.toggle('collapsed');
            this.fitTerminal();
            this.editor && this.editor.resize(true);
        }
    }

    _loadTerminalFontSize() {
        const stored = parseInt(localStorage.getItem('terminalFontSize'), 10);
        return !isNaN(stored) ? Math.min(32, Math.max(10, stored)) : 13;
    }

    setEditorMode(language) {
        const modeMap = {
            'python': 'python',
            'c': 'c_cpp',
            'cpp': 'c_cpp',
            'java': 'java',
            'javascript': 'javascript',
            'go': 'golang',
            'rust': 'rust',
            'json': 'json'
        };
        this.editor.session.setMode(`ace/mode/${modeMap[language] || 'text'}`);
    }

    setupEventListeners() {
        // Project selector
        document.getElementById('projectSelect').addEventListener('change', (e) => {
            if (e.target.value) {
                this.loadProject(e.target.value);
            }
        });

        // Buttons
        document.getElementById('saveButton').addEventListener('click', () => this.saveCurrentFile());
        document.getElementById('runButton').addEventListener('click', () => {
            if (this.isRunning) {
                this.stopExecution();
            } else {
                this.runCode();
            }
        });

        // Terminal controls
        document.getElementById('clearTerminalBtn')?.addEventListener('click', () => this.clearTerminal());
        document.getElementById('toggleTerminalBtn')?.addEventListener('click', () => this.toggleTerminal());
    }

    async runCode() {
        const code = this.editor.getValue();
        const language = document.getElementById('languageSelect').value;

        if (!code.trim()) {
            alert('Please enter some code first');
            return;
        }

        // Clear terminal
        this.clearTerminal();
        this.isRunning = true;
        this.updateRunButton();

        // Connect WebSocket if needed
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            await this.connectWebSocket();
        }

        // Execute code
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                action: 'run',
                code: code,
                language: language
            }));
        }
    }

    async connectWebSocket() {
        if (this.wsConnecting) return;
        this.wsConnecting = true;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?token=${this.authToken}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.wsConnecting = false;
        };

        this.ws.onmessage = (event) => {
            this.handleWebSocketMessage(event.data);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.wsConnecting = false;
        };

        this.ws.onclose = () => {
            console.log('WebSocket closed');
            this.ws = null;
            this.wsConnecting = false;
            this.isRunning = false;
            this.updateRunButton();
        };

        // Wait for connection
        await new Promise((resolve) => {
            const checkConnection = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    clearInterval(checkConnection);
                    resolve();
                }
            }, 100);
        });
    }

    handleWebSocketMessage(data) {
        if (data.startsWith('OUTPUT ')) {
            const output = data.substring(7);
            if (this.xterm) {
                this.xterm.write(output.replace(/\n/g, '\r\n'));
            }
        } else if (data === 'EXECUTION_COMPLETE') {
            this.isRunning = false;
            this.updateRunButton();
        } else if (data.startsWith('ERROR ')) {
            const error = data.substring(6);
            if (this.xterm) {
                this.xterm.write(`\x1b[31m${error}\x1b[0m\r\n`);
            }
            this.isRunning = false;
            this.updateRunButton();
        }
    }

    stopExecution() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send('STOP');
        }
        this.isRunning = false;
        this.updateRunButton();
    }

    updateRunButton() {
        const runButton = document.getElementById('runButton');
        if (this.isRunning) {
            runButton.textContent = '⏹ Stop';
            runButton.classList.add('running');
        } else {
            runButton.textContent = '▶ Run';
            runButton.classList.remove('running');
        }
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

    async loadProjects() {
        try {
            const response = await fetch('/api/projects', {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            if (response.ok) {
                const data = await response.json();
                this.populateProjectSelector(data.projects);
            }
        } catch (error) {
            console.error('Failed to load projects:', error);
        }
    }

    populateProjectSelector(projects) {
        const select = document.getElementById('projectSelect');
        select.innerHTML = '';
        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.name;
            option.textContent = project.name;
            select.appendChild(option);
        });
    }

    async loadProject(projectName) {
        this.currentProject = projectName;
        try {
            const response = await fetch(`/api/files/${projectName}`, {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            if (response.ok) {
                const data = await response.json();
                this.populateFileTree(data.files);
            }
        } catch (error) {
            console.error('Failed to load project files:', error);
        }
    }

    populateFileTree(items) {
        const fileTree = document.getElementById('fileTree');
        fileTree.innerHTML = '';
        
        if (items.length === 0) {
            fileTree.innerHTML = '<div class="no-files">No files in project</div>';
            return;
        }

        items.forEach(item => {
            const itemEl = this.createFileTreeItem(item);
            fileTree.appendChild(itemEl);
        });
    }

    createFileTreeItem(item) {
        const div = document.createElement('div');
        div.className = item.is_folder ? 'tree-folder' : 'tree-file';
        div.innerHTML = `<span>${item.name}</span>`;
        
        if (!item.is_folder) {
            div.addEventListener('click', () => this.openFile(item.path));
        }
        
        return div;
    }

    async openFile(filePath) {
        try {
            const response = await fetch(`/api/files/${this.currentProject}/${filePath}`, {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            if (response.ok) {
                const data = await response.json();
                this.editor.setValue(data.content, -1);
                this.currentFile = filePath;
            }
        } catch (error) {
            console.error('Failed to open file:', error);
        }
    }

    async saveCurrentFile() {
        if (!this.currentFile) {
            alert('No file is currently open');
            return;
        }

        const content = this.editor.getValue();
        try {
            const response = await fetch(`/api/files/${this.currentProject}/${this.currentFile}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ content })
            });
            
            if (response.ok) {
                console.log('File saved successfully');
            }
        } catch (error) {
            console.error('Failed to save file:', error);
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

