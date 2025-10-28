

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
        this.shouldAutoRunOnce = false;
        this.fontSize = this._loadFontSize();
        this.currentFolder = null;
        
        // Terminal properties
        this.xterm = null;
        this.fitAddon = null;
        this.terminalInputBuffer = '';
        this.textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
        this.MIN_TERMINAL_FONT_SIZE = 10;
        this.MAX_TERMINAL_FONT_SIZE = 32;
        this.MIN_TERMINAL_HEIGHT = 120;
        this.MIN_EDITOR_HEIGHT = 200;
        this.terminalFontSize = this._loadTerminalFontSize();
        this.terminalPreferredHeight = this._loadTerminalHeight();
        this.terminalResizerInitialized = false;
        
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

        this.editor.commands.addCommand({
            name: 'format',
            bindKey: {win: 'Ctrl-Alt-L', mac: 'Command-Alt-L'},
            exec: () => this.formatCode()
        });

        // Font size shortcuts
        this.editor.commands.addCommand({
            name: 'increaseFont',
            bindKey: { win: 'Ctrl-=', mac: 'Command-=' },
            exec: () => this.increaseFontSize()
        });

        this.editor.commands.addCommand({
            name: 'decreaseFont',
            bindKey: { win: 'Ctrl--', mac: 'Command--' },
            exec: () => this.decreaseFontSize()
        });

        this.editor.commands.addCommand({
            name: 'resetFont',
            bindKey: { win: 'Ctrl-0', mac: 'Command-0' },
            exec: () => this.resetFontSize()
        });

        // Handle resize
        const doLayout = () => {
            try {
                this.editor && this.editor.resize(true);
            } catch (_) {}
        };
        window.addEventListener('resize', doLayout);
        setTimeout(doLayout, 0);

        // Setup linting on code change
        this.lintTimeout = null;
        this.editor.session.on('change', () => {
            clearTimeout(this.lintTimeout);
            this.lintTimeout = setTimeout(() => {
                this.lintCode();
            }, 1000); // Lint 1 second after user stops typing
        });

        // Update editor mode on language change
        document.getElementById('languageSelect').addEventListener('change', (e) => {
            this.setEditorMode(e.target.value);
            this.lintCode(); // Re-lint when language changes
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

        // Create terminal instance
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

        // Load fit addon
        try {
            if (window.FitAddon && typeof window.FitAddon.FitAddon === 'function') {
                this.fitAddon = new window.FitAddon.FitAddon();
            } else if (typeof FitAddon !== 'undefined' && typeof FitAddon.FitAddon === 'function') {
                this.fitAddon = new FitAddon.FitAddon();
            }
            if (this.fitAddon) {
                this.xterm.loadAddon(this.fitAddon);
            }
        } catch (err) {
            console.warn('[Terminal] Failed to load fit addon:', err);
            this.fitAddon = null;
        }

        this.xterm.open(container);
        this._applyTerminalHeight();
        this.fitTerminal();
        this.focusTerminal();

        // Handle resize events
        window.addEventListener('resize', () => {
            const terminalPanel = document.querySelector('.terminal-panel');
            const isCollapsed = terminalPanel && terminalPanel.classList.contains('collapsed');
            if (!isCollapsed) {
                const targetHeight = this.terminalPreferredHeight != null ? 
                    this.terminalPreferredHeight : this._getCurrentTerminalHeight();
                this.setTerminalHeight(targetHeight, { persist: false, skipFit: true });
            }
            this.fitTerminal();
            try {
                this.editor && this.editor.resize(true);
            } catch (_) {}
        });

        this.terminalInputBuffer = '';
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

        // Ignore escape sequences
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

    getTerminalText(maxLines = 400) {
        if (!this.xterm || !this.xterm.buffer || !this.xterm.buffer.active) {
            return '';
        }
        const buffer = this.xterm.buffer.active;
        const end = buffer.length;
        const start = Math.max(0, end - maxLines);
        const lines = [];
        for (let i = start; i < end; i++) {
            const line = buffer.getLine(i);
            if (!line) continue;
            lines.push(line.translateToString(true));
        }
        return lines.join('\n').trimEnd();
    }

    setEditorMode(language) {
        const modeMap = {
            'python': 'python',
            'c': 'c_cpp',
            'cpp': 'c_cpp',
            'c++': 'c_cpp',
            'java': 'java',
            'javascript': 'javascript',
            'go': 'golang',
            'rust': 'rust',
            'json': 'json'
        };
        this.editor.session.setMode(`ace/mode/${modeMap[language] || 'text'}`);
    }

    setupEventListeners() {
        // Close error panel button
        document.getElementById('closeErrorPanelBtn').addEventListener('click', () => this.clearErrors());

        // Project selector
        document.getElementById('projectSelect').addEventListener('change', (e) => {
            if (e.target.value) {
                this.loadProject(e.target.value);
            }
        });

        // New project button
        document.getElementById('newProjectBtn').addEventListener('click', () => this.showNewProjectModal());

        // Helper function to bind clicks safely
        const bindClick = (id, handler) => {
            const el = document.getElementById(id);
            if (!el) {
                console.warn(`[UI] Element #${id} not found; skipping handler.`);
                return;
            }
            el.addEventListener('click', handler);
        };

        // Main buttons
        bindClick('runButton', () => {
            if (this.isRunning) {
                this.stopExecution();
            } else {
                this.runCode();
            }
        });
        bindClick('saveButton', () => this.saveCurrentFile());
        bindClick('formatButton', () => this.formatCode());
        bindClick('newFileBtn', () => this.showNewFileModal());
        bindClick('newFolderBtn', () => this.showNewFolderModal());
        bindClick('fontIncrease', () => this.increaseFontSize());
        bindClick('fontDecrease', () => this.decreaseFontSize());
        bindClick('terminalFontIncrease', () => this.increaseTerminalFont());
        bindClick('terminalFontDecrease', () => this.decreaseTerminalFont());

        // Terminal controls
        bindClick('clearTerminalBtn', () => this.clearTerminal());
        bindClick('toggleTerminalBtn', () => this.toggleTerminal());

        // Modal controls
        document.getElementById('closeNewProjectModal').addEventListener('click', () => this.hideModal('newProjectModal'));
        document.getElementById('cancelNewProject').addEventListener('click', () => this.hideModal('newProjectModal'));
        document.getElementById('cancelNewFile').addEventListener('click', () => this.hideModal('newFileModal'));
        
        const cancelNewFolder = document.getElementById('cancelNewFolder');
        if (cancelNewFolder) cancelNewFolder.addEventListener('click', () => this.hideModal('newFolderModal'));
        
        const closeNewFolderModal = document.getElementById('closeNewFolderModal');
        if (closeNewFolderModal) closeNewFolderModal.addEventListener('click', () => this.hideModal('newFolderModal'));

        // Forms
        document.getElementById('newProjectForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createProject();
        });

        document.getElementById('newFileForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createFile();
        });

        const newFolderForm = document.getElementById('newFolderForm');
        if (newFolderForm) {
            newFolderForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createFolder();
            });
        }

        // Initialize terminal resizer
        this.initTerminalResizer();
    }

    async lintCode() {
        const code = this.editor.getValue();
        const language = document.getElementById('languageSelect').value;

        if (!code.trim()) {
            this.clearErrors();
            return;
        }

        try {
            const response = await fetch('/api/lint', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code, language })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.errors && data.errors.length > 0) {
                    this.displayErrors(data.errors);
                } else {
                    this.clearErrors();
                }
            }
        } catch (error) {
            console.error('Linting error:', error);
        }
    }

    displayErrors(errors) {
        const errorPanel = document.getElementById('errorPanel');
        const errorList = document.getElementById('errorList');
        
        errorList.innerHTML = '';
        errors.forEach(error => {
            const errorItem = document.createElement('div');
            errorItem.className = 'error-item';
            errorItem.innerHTML = `
                <span class="error-icon">⚠️</span>
                <span class="error-text">Line ${error.line}: ${error.message}</span>
            `;
            errorItem.addEventListener('click', () => {
                this.editor.gotoLine(error.line, 0, true);
                this.editor.focus();
            });
            errorList.appendChild(errorItem);
        });
        
        errorPanel.classList.add('visible');
    }

    clearErrors() {
        const errorPanel = document.getElementById('errorPanel');
        errorPanel.classList.remove('visible');
    }

    async formatCode() {
        const code = this.editor.getValue();
        const language = document.getElementById('languageSelect').value;

        if (!code.trim()) {
            this.showNotification('No code to format', 'warning');
            return;
        }

        const formatBtn = document.getElementById('formatButton');
        const originalHTML = formatBtn.innerHTML;
        formatBtn.innerHTML = '<span class="spinner"></span> Formatting...';
        formatBtn.disabled = true;

        try {
            const response = await fetch('/api/format', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code: code, language: language })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    if (data.changed) {
                        // Preserve cursor position
                        const cursor = this.editor.getCursorPosition();
                        this.editor.setValue(data.code, -1);
                        this.editor.moveCursorToPosition(cursor);
                        this.showNotification('Code formatted successfully!', 'success');
                        
                        // Re-lint after formatting
                        setTimeout(() => this.lintCode(), 500);
                    } else {
                        this.showNotification('Code is already formatted', 'info');
                    }
                } else {
                    this.showNotification(data.message || 'Formatting not available for this language', 'warning');
                }
            } else {
                this.showNotification('Failed to format code', 'error');
            }
        } catch (error) {
            console.error('Format error:', error);
            this.showNotification('Failed to format code', 'error');
        } finally {
            formatBtn.innerHTML = originalHTML;
            formatBtn.disabled = false;
        }
    }

    _loadFontSize() {
        const stored = parseInt(localStorage.getItem('editorFontSize'), 10);
        if (!isNaN(stored)) {
            return Math.min(28, Math.max(10, stored));
        }
        return 14;
    }

    _applyFontSize() {
        if (this.editor) {
            try {
                this.editor.setFontSize(`${this.fontSize}px`);
                this.editor.resize(true);
            } catch (_) {}
        }
    }

    setFontSize(px) {
        const clamped = Math.min(28, Math.max(10, Math.round(px)));
        this.fontSize = clamped;
        localStorage.setItem('editorFontSize', String(this.fontSize));
        this._applyFontSize();
        this.showNotification(`Font size: ${this.fontSize}px`, 'info');
    }

    increaseFontSize() {
        this.setFontSize(this.fontSize + 1);
    }

    decreaseFontSize() {
        this.setFontSize(this.fontSize - 1);
    }

    resetFontSize() {
        this.setFontSize(14);
    }

    _loadTerminalFontSize() {
        const stored = parseInt(localStorage.getItem('terminalFontSize'), 10);
        if (!isNaN(stored)) {
            return Math.min(this.MAX_TERMINAL_FONT_SIZE, Math.max(this.MIN_TERMINAL_FONT_SIZE, stored));
        }
        return 13;
    }

    _loadTerminalHeight() {
        const stored = parseInt(localStorage.getItem('terminalPanelHeight'), 10);
        if (!isNaN(stored)) {
            return Math.max(this.MIN_TERMINAL_HEIGHT, stored);
        }
        return null;
    }

    setTerminalFontSize(px) {
        const clamped = Math.min(this.MAX_TERMINAL_FONT_SIZE, Math.max(this.MIN_TERMINAL_FONT_SIZE, Math.round(px)));
        this.terminalFontSize = clamped;
        localStorage.setItem('terminalFontSize', String(clamped));
        if (this.xterm) {
            this.xterm.options.fontSize = clamped;
            this.fitTerminal();
            this.focusTerminal();
            this.showNotification(`Terminal font size: ${clamped}px`, 'info');
        }
    }

    increaseTerminalFont() {
        this.setTerminalFontSize(this.terminalFontSize + 1);
    }

    decreaseTerminalFont() {
        this.setTerminalFontSize(this.terminalFontSize - 1);
    }

    resetTerminalFontSize() {
        this.setTerminalFontSize(13);
    }

    _getCurrentTerminalHeight() {
        const terminalPanel = document.querySelector('.terminal-panel');
        if (!terminalPanel) {
            return this.terminalPreferredHeight || 250;
        }
        const rect = terminalPanel.getBoundingClientRect();
        if (!rect || !rect.height) {
            return this.terminalPreferredHeight || 250;
        }
        return Math.max(this.MIN_TERMINAL_HEIGHT, Math.round(rect.height));
    }

    _computeMaxTerminalHeight(resizer, mainContent) {
        if (!mainContent) {
            return this.terminalPreferredHeight || 250;
        }
        const mainRect = mainContent.getBoundingClientRect();
        if (!mainRect || mainRect.height <= 0) {
            return Math.max(this.MIN_TERMINAL_HEIGHT, this.terminalPreferredHeight || 250);
        }
        const resizerHeight = resizer ? (resizer.getBoundingClientRect().height || 6) : 6;
        const possible = Math.round(mainRect.height - resizerHeight - this.MIN_EDITOR_HEIGHT);
        return Math.max(this.MIN_TERMINAL_HEIGHT, possible);
    }

    _applyTerminalHeight() {
        const height = this.terminalPreferredHeight != null ? this.terminalPreferredHeight : 250;
        this.setTerminalHeight(height, { persist: false, skipFit: true });
    }

    setTerminalHeight(height, { persist = true, skipFit = false } = {}) {
        const terminalPanel = document.querySelector('.terminal-panel');
        if (terminalPanel == null || height == null) {
            return;
        }

        let clamped = Math.round(Number(height));
        if (!Number.isFinite(clamped)) {
            return;
        }

        clamped = Math.max(this.MIN_TERMINAL_HEIGHT, clamped);

        const resizer = document.getElementById('terminalResizer');
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            const maxHeight = this._computeMaxTerminalHeight(resizer, mainContent);
            clamped = Math.min(clamped, maxHeight);
        }

        this.terminalPreferredHeight = clamped;
        if (persist) {
            localStorage.setItem('terminalPanelHeight', String(clamped));
        }

        if (terminalPanel.classList.contains('collapsed')) {
            return;
        }

        terminalPanel.style.flex = `0 0 ${clamped}px`;
        terminalPanel.style.height = `${clamped}px`;

        if (!skipFit) {
            this.fitTerminal();
            try {
                this.editor && this.editor.resize(true);
            } catch (_) {}
        }
    }

    initTerminalResizer() {
        if (this.terminalResizerInitialized) {
            return;
        }

        const resizer = document.getElementById('terminalResizer');
        const terminalPanel = document.querySelector('.terminal-panel');
        const mainContent = document.querySelector('.main-content');

        if (!resizer || !terminalPanel || !mainContent) {
            return;
        }

        this.terminalResizerInitialized = true;

        let isDragging = false;
        let startY = 0;
        let startHeight = this._getCurrentTerminalHeight();

        const updateConstraints = () => {
            startHeight = Math.max(this.MIN_TERMINAL_HEIGHT, this._getCurrentTerminalHeight());
        };

        const onPointerMove = (event) => {
            if (!isDragging) return;

            const mainMax = this._computeMaxTerminalHeight(resizer, mainContent);
            const delta = startY - event.clientY;
            let nextHeight = startHeight + delta;
            nextHeight = Math.max(this.MIN_TERMINAL_HEIGHT, Math.min(mainMax, nextHeight));
            this.setTerminalHeight(nextHeight, { persist: false });
        };

        const stopResize = () => {
            if (!isDragging) return;
            isDragging = false;
            document.body.classList.remove('resizing-vertical');
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', stopResize);
            window.removeEventListener('pointercancel', stopResize);

            if (this.terminalPreferredHeight != null) {
                this.setTerminalHeight(this.terminalPreferredHeight, { persist: true });
            }
        };

        resizer.addEventListener('pointerdown', (event) => {
            if (terminalPanel.classList.contains('collapsed')) {
                event.preventDefault();
                return;
            }
            event.preventDefault();
            isDragging = true;
            startY = event.clientY;
            updateConstraints();
            document.body.classList.add('resizing-vertical');
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', stopResize);
            window.addEventListener('pointercancel', stopResize);
        });

        // Keyboard support for accessibility
        resizer.addEventListener('keydown', (event) => {
            if (terminalPanel.classList.contains('collapsed')) {
                return;
            }
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                const step = event.shiftKey ? 40 : 16;
                const mainMax = this._computeMaxTerminalHeight(resizer, mainContent);
                const current = this._getCurrentTerminalHeight();
                const delta = event.key === 'ArrowUp' ? step : -step;
                let nextHeight = current + delta;
                nextHeight = Math.max(this.MIN_TERMINAL_HEIGHT, Math.min(mainMax, nextHeight));
                this.setTerminalHeight(nextHeight, { persist: true });
            }
        });
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

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Add to body
        document.body.appendChild(notification);
        
        // Trigger animation
        setTimeout(() => notification.classList.add('show'), 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    showModal(modalId) {
        document.getElementById(modalId).style.display = 'block';
    }

    hideModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    showNewProjectModal() {
        this.showModal('newProjectModal');
    }

    showNewFileModal() {
        if (!this.currentProject) {
            this.showNotification('Please select a project first', 'error');
            return;
        }

        const fileNameInput = document.getElementById('fileName');
        if (this.currentFolder) {
            fileNameInput.placeholder = `e.g., ${this.currentFolder}/main.py`;
        } else {
            fileNameInput.placeholder = 'Enter file name (e.g., main.py)';
        }
        this.showModal('newFileModal');
    }

    showNewFolderModal() {
        if (!this.currentProject) {
            this.showNotification('Please select a project first', 'error');
            return;
        }
        this.showModal('newFolderModal');
    }

    async createProject() {
        const projectName = document.getElementById('projectName').value;
        if (!projectName.trim()) {
            this.showNotification('Please enter a project name', 'error');
            return;
        }

        try {
            const response = await fetch('/api/projects/create', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ project_name: projectName })
            });

            if (response.ok) {
                this.showNotification('Project created successfully', 'success');
                this.hideModal('newProjectModal');
                document.getElementById('projectName').value = '';
                await this.loadProjects();
            } else {
                const error = await response.json();
                this.showNotification(error.detail || 'Failed to create project', 'error');
            }
        } catch (error) {
            console.error('Failed to create project:', error);
            this.showNotification('Failed to create project', 'error');
        }
    }

    async createFile() {
        let fileName = document.getElementById('fileName').value;
        if (!fileName.trim()) {
            this.showNotification('Please enter a file name', 'error');
            return;
        }

        // Prepend folder path if selected
        if (this.currentFolder && !fileName.includes('/') && !fileName.includes('\\')) {
            fileName = `${this.currentFolder}/${fileName}`;
        }

        try {
            const response = await fetch('/api/files/create', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    project_name: this.currentProject,
                    file_path: fileName,
                    content: ''
                })
            });

            if (response.ok) {
                this.showNotification('File created successfully', 'success');
                this.hideModal('newFileModal');
                document.getElementById('fileName').value = '';
                await this.loadProject(this.currentProject);
            } else {
                const error = await response.json();
                this.showNotification(error.detail || 'Failed to create file', 'error');
            }
        } catch (error) {
            console.error('Failed to create file:', error);
            this.showNotification('Failed to create file', 'error');
        }
    }

    async createFolder() {
        const folderName = document.getElementById('folderName').value;
        if (!folderName.trim()) {
            this.showNotification('Please enter a folder path', 'error');
            return;
        }

        try {
            const response = await fetch('/api/folders/create', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    project_name: this.currentProject,
                    folder_path: folderName
                })
            });

            if (response.ok) {
                this.showNotification('Folder created successfully', 'success');
                this.hideModal('newFolderModal');
                document.getElementById('folderName').value = '';
                await this.loadProject(this.currentProject);
            } else {
                const error = await response.json();
                this.showNotification(error.detail || 'Failed to create folder', 'error');
            }
        } catch (error) {
            console.error('Failed to create folder:', error);
            this.showNotification('Failed to create folder', 'error');
        }
    }

    async deleteFile(filePath) {
        // Normalize path
        filePath = filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

        const confirmed = confirm(`Are you sure you want to delete "${filePath}"? This cannot be undone.`);
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/files/${this.currentProject}/${filePath}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });

            if (response.ok) {
                this.showNotification('File deleted successfully', 'success');
                
                // Close tab if file is currently open
                if (this.currentFile === filePath) {
                    this.closeFile(filePath);
                } else if (this.openFiles.has(filePath)) {
                    this.openFiles.delete(filePath);
                    const tabs = document.querySelectorAll('.file-tab');
                    tabs.forEach(tab => {
                        if (tab.getAttribute('data-file') === filePath) {
                            tab.remove();
                        }
                    });
                }
                
                // Refresh file tree
                await this.loadProject(this.currentProject);
            } else {
                const error = await response.json();
                this.showNotification(error.detail || 'Failed to delete file', 'error');
            }
        } catch (error) {
            console.error('Failed to delete file:', error);
            this.showNotification('Failed to delete file', 'error');
        }
    }

    async deleteFolder(folderPath) {
        // Normalize path
        folderPath = folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

        const confirmed = confirm(`Are you sure you want to delete folder "${folderPath}" and all its contents? This cannot be undone.`);
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/folders/${this.currentProject}/${folderPath}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });

            if (response.ok) {
                this.showNotification('Folder deleted successfully', 'success');
                
                // Close all open files within this folder
                const filesToClose = [];
                this.openFiles.forEach((content, path) => {
                    if (path.startsWith(folderPath + '/')) {
                        filesToClose.push(path);
                    }
                });

                filesToClose.forEach(path => {
                    if (this.currentFile === path) {
                        this.closeFile(path);
                    } else {
                        this.openFiles.delete(path);
                        const tabs = document.querySelectorAll('.file-tab');
                        tabs.forEach(tab => {
                            if (tab.getAttribute('data-file') === path) {
                                tab.remove();
                            }
                        });
                    }
                });

                // Deactivate if this was the active folder
                if (this.currentFolder === folderPath) {
                    this.currentFolder = null;
                }
                
                // Refresh file tree
                await this.loadProject(this.currentProject);
            } else {
                const error = await response.json();
                this.showNotification(error.detail || 'Failed to delete folder', 'error');
            }
        } catch (error) {
            console.error('Failed to delete folder:', error);
            this.showNotification('Failed to delete folder', 'error');
        }
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
                language: language,
                project: this.currentProject,
                file: this.currentFile
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

    createFileTreeItem(item, level = 0) {
        const div = document.createElement('div');
        div.className = item.is_folder ? 'tree-folder' : 'tree-file';
        div.style.paddingLeft = `${level * 16}px`;
        
        const icon = item.is_folder ? '📁' : '📄';
        const actions = !item.is_folder ? 
            `<button class="delete-btn" onclick="compiler.deleteFile('${item.path}')">🗑️</button>` :
            `<button class="delete-btn" onclick="compiler.deleteFolder('${item.path}')">🗑️</button>`;
        
        div.innerHTML = `<span>${icon} ${item.name}</span>${actions}`;
        
        if (item.is_folder) {
            div.addEventListener('click', (e) => {
                if (!e.target.classList.contains('delete-btn')) {
                    this.currentFolder = item.path;
                    div.classList.toggle('expanded');
                }
            });
            
            // Render children if folder is expanded
            if (item.children) {
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'folder-children';
                item.children.forEach(child => {
                    childrenContainer.appendChild(this.createFileTreeItem(child, level + 1));
                });
                div.appendChild(childrenContainer);
            }
        } else {
            div.addEventListener('click', (e) => {
                if (!e.target.classList.contains('delete-btn')) {
                    this.openFile(item.path);
                }
            });
        }
        
        return div;
    }

    async openFile(filePath) {
        // Check if file is already open
        if (this.openFiles.has(filePath)) {
            this.switchToFile(filePath);
            return;
        }

        try {
            const response = await fetch(`/api/files/${this.currentProject}/${filePath}`, {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            if (response.ok) {
                const data = await response.json();
                this.openFiles.set(filePath, data.content);
                this.createFileTab(filePath);
                this.switchToFile(filePath);
            }
        } catch (error) {
            console.error('Failed to open file:', error);
        }
    }

    createFileTab(filePath) {
        const tabsContainer = document.querySelector('.file-tabs');
        const tab = document.createElement('div');
        tab.className = 'file-tab';
        tab.setAttribute('data-file', filePath);
        
        const fileName = filePath.split('/').pop();
        tab.innerHTML = `
            <span class="tab-name">${fileName}</span>
            <button class="tab-close" onclick="compiler.closeFile('${filePath}')">×</button>
        `;
        
        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                this.switchToFile(filePath);
            }
        });
        
        tabsContainer.appendChild(tab);
    }

    switchToFile(filePath) {
        // Save current file content
        if (this.currentFile) {
            this.openFiles.set(this.currentFile, this.editor.getValue());
        }

        // Switch to new file
        this.currentFile = filePath;
        this.editor.setValue(this.openFiles.get(filePath) || '', -1);

        // Update active tab
        document.querySelectorAll('.file-tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-file') === filePath);
        });

        // Trigger linting for the new file
        this.lintCode();
    }

    closeFile(filePath) {
        this.openFiles.delete(filePath);
        
        const tab = document.querySelector(`.file-tab[data-file="${filePath}"]`);
        if (tab) {
            tab.remove();
        }

        if (this.currentFile === filePath) {
            const remainingFiles = Array.from(this.openFiles.keys());
            if (remainingFiles.length > 0) {
                this.switchToFile(remainingFiles[0]);
            } else {
                this.currentFile = null;
                this.editor.setValue('', -1);
                this.clearErrors();
            }
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
                this.showNotification('File saved successfully', 'success');
                this.openFiles.set(this.currentFile, content);
            }
        } catch (error) {
            console.error('Failed to save file:', error);
            this.showNotification('Failed to save file', 'error');
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

// Add CSS for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);

