// Enhanced BlackMoon Compiler - JavaScript
class BlackMoonCompiler {
    constructor() {
        this.editor = null;
        this.currentProject = null;
        this.currentFile = null;
        this.openFiles = new Map();
        this.ws = null;
        this.wsConnecting = false; // prevent duplicate WS connects
        this.isRunning = false;
        this.authToken = localStorage.getItem('authToken');
        this.explanationCache = null; // Cache for AI explanations
        this.currentExplanations = {}; // Store different explanation types
        this.shouldAutoRunOnce = false; // trigger a single run after WS connects
        this.fontSize = this._loadFontSize(); // editor font size in px
        this.currentFolder = null; // track selected folder for file creation
        this.userProfile = null; // User profile data
        this.chatInitialized = false; // AI chat initialization flag
        this.chatMessages = []; // Chat message history
        this.xterm = null; // xterm.js terminal instance
        this.fitAddon = null; // Fit addon for responsive sizing
        this.terminalInputBuffer = ''; // Buffered user input before submit
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

        // Initialize CodeMirror
        this.initEditor();
        this.initTerminal();
        
        // Load user profile
        await this.loadUserProfile();
        
        // Load user projects
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

        // Ensure editor resizes with layout changes
        const doLayout = () => {
            try { this.editor && this.editor.resize(true); } catch (_) {}
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

        // Update editor mode when language changes
        document.getElementById('languageSelect').addEventListener('change', (e) => {
            this.setEditorMode(e.target.value);
            this.lintCode(); // Re-lint when language changes
        });
    }

    initTerminal() {
        if (this.xterm) {
            return;
        }

        const container = document.getElementById('terminal-container');
        if (!container) {
            console.warn('[Terminal] Container not found.');
            return;
        }
        if (typeof Terminal === 'undefined') {
            console.warn('[Terminal] xterm.js not loaded.');
            return;
        }

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
            console.warn('[Terminal] Failed to initialise fit addon:', err);
            this.fitAddon = null;
        }

        this.xterm.open(container);
    this._applyTerminalHeight();
        this.fitTerminal();
        this.focusTerminal();

        window.addEventListener('resize', () => {
            const terminalPanel = document.querySelector('.terminal-panel');
            const isCollapsed = terminalPanel && terminalPanel.classList.contains('collapsed');

            if (!isCollapsed) {
                const targetHeight = this.terminalPreferredHeight != null
                    ? this.terminalPreferredHeight
                    : this._getCurrentTerminalHeight();
                this.setTerminalHeight(targetHeight, { persist: false, skipFit: true });
            }

            this.fitTerminal();
            try { this.editor && this.editor.resize(true); } catch (_) {}
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

        // Ignore escape sequences (arrow keys etc.) for now
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
                case '\u007f': // Backspace / DEL
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
        // Settings button
        document.getElementById('settingsButton').addEventListener('click', () => this.showSettings());
        
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
        
        // New file button
        // Helper to bind clicks safely
        const bindClick = (id, handler) => {
            const el = document.getElementById(id);
            if (!el) {
                console.warn(`[UI] Element #${id} not found; skipping handler.`);
                return;
            }
            el.addEventListener('click', handler);
        };

        // Buttons
        bindClick('runButton', () => {
            if (this.isRunning) {
                this.stopExecution();
            } else {
                this.runCode();
            }
        });
        bindClick('saveButton', () => this.saveCurrentFile());
        bindClick('explainButton', () => this.explainCode());
        bindClick('askAiButton', () => this.showAiChat());
        bindClick('newFileBtn', () => this.showNewFileModal());
        bindClick('newFolderBtn', () => this.showNewFolderModal());
        bindClick('fontIncrease', () => this.increaseFontSize());
        bindClick('fontDecrease', () => this.decreaseFontSize());
    bindClick('terminalFontIncrease', () => this.increaseTerminalFont());
    bindClick('terminalFontDecrease', () => this.decreaseTerminalFont());
        
        // Profile dropdown
        bindClick('profileButton', () => this.toggleProfileMenu());
        bindClick('profileMenuItem', () => {
            this.hideProfileMenu();
            this.showProfile();
        });
        bindClick('mySharesMenuItem', () => {
            this.hideProfileMenu();
            this.showMyShares();
        });
        bindClick('settingsMenuItem', () => {
            this.hideProfileMenu();
            this.showSettings();
        });
        bindClick('logoutMenuItem', () => this.logout());
        
        // Close profile menu when clicking outside
        document.addEventListener('click', (e) => {
            const profileDropdown = document.querySelector('.profile-dropdown');
            if (profileDropdown && !profileDropdown.contains(e.target)) {
                this.hideProfileMenu();
            }
        });
        
        document.getElementById('closeAiModal').addEventListener('click', () => this.hideModal('aiModal'));
        document.getElementById('closeNewProjectModal').addEventListener('click', () => this.hideModal('newProjectModal'));
        const langSel = document.getElementById('languageSelect');
        if (langSel) {
            langSel.addEventListener('change', (e) => {
                this.setEditorMode(e.target.value);
                this.lintCode(); // Re-lint when language changes
            });
        } else {
            console.warn('[UI] #languageSelect not found.');
        }

        // Terminal controls
        bindClick('clearTerminalBtn', () => this.clearTerminal());
        bindClick('toggleTerminalBtn', () => this.toggleTerminal());
        document.getElementById('cancelNewProject').addEventListener('click', () => this.hideModal('newProjectModal'));
    document.getElementById('cancelNewFile').addEventListener('click', () => this.hideModal('newFileModal'));
    const cancelNewFolder = document.getElementById('cancelNewFolder');
    if (cancelNewFolder) cancelNewFolder.addEventListener('click', () => this.hideModal('newFolderModal'));
    const closeNewFolderModal = document.getElementById('closeNewFolderModal');
    if (closeNewFolderModal) closeNewFolderModal.addEventListener('click', () => this.hideModal('newFolderModal'));
        document.getElementById('cancelSettings').addEventListener('click', () => this.hideModal('settingsModal'));
        
        // Profile modal
        const closeProfileModal = document.getElementById('closeProfileModal');
        if (closeProfileModal) closeProfileModal.addEventListener('click', () => this.hideModal('profileModal'));
        const cancelProfile = document.getElementById('cancelProfile');
        if (cancelProfile) cancelProfile.addEventListener('click', () => this.hideModal('profileModal'));
        
        // My Shares modal
        const closeMySharesModal = document.getElementById('closeMySharesModal');
        if (closeMySharesModal) closeMySharesModal.addEventListener('click', () => this.hideModal('mySharesModal'));
        
        // Share Link modal
        const closeShareLinkModal = document.getElementById('closeShareLinkModal');
        if (closeShareLinkModal) closeShareLinkModal.addEventListener('click', () => this.hideModal('shareLinkModal'));
        const copyShareLinkBtn = document.getElementById('copyShareLinkBtn');
        if (copyShareLinkBtn) copyShareLinkBtn.addEventListener('click', () => this.copyShareLink());
        
        // Profile picture upload
        const profilePicInput = document.getElementById('profilePicInput');
        if (profilePicInput) {
            profilePicInput.addEventListener('change', (e) => this.handleProfilePictureUpload(e));
        }
        
        // AI Chat modal
        const closeAiChatModal = document.getElementById('closeAiChatModal');
        if (closeAiChatModal) closeAiChatModal.addEventListener('click', () => this.hideModal('aiChatModal'));
        const sendChatBtn = document.getElementById('sendChatBtn');
        if (sendChatBtn) sendChatBtn.addEventListener('click', () => this.sendChatMessage());
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage();
                }
            });
        }
        
        // Modal forms
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
        
        // Profile form
        const profileForm = document.getElementById('profileForm');
        if (profileForm) {
            profileForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.updateProfile();
            });
        }
        
        document.getElementById('apiKeyForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateApiKey();
        });
        
        // AI explanation tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchExplanationTab(e.target.dataset.tab);
            });
        });
        
        // Format button
        document.getElementById('formatButton').addEventListener('click', () => this.formatCode());

        // Terminal resizer after DOM is ready
        this.initTerminalResizer();
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
            try { this.editor && this.editor.resize(true); } catch (_) {}
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
            if (!isDragging) {
                return;
            }
            const mainMax = this._computeMaxTerminalHeight(resizer, mainContent);
            const delta = startY - event.clientY;
            let nextHeight = startHeight + delta;
            nextHeight = Math.max(this.MIN_TERMINAL_HEIGHT, Math.min(mainMax, nextHeight));
            this.setTerminalHeight(nextHeight, { persist: false });
        };

        const stopResize = () => {
            if (!isDragging) {
                return;
            }
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
        select.innerHTML = '<option value="">Select Project</option>';
        
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
            fileTree.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><p>No files in project</p></div>';
            return;
        }
        
        // Build hierarchical tree structure
        const tree = this.buildFileTree(items);
        
        // Render the tree
        this.renderFileTree(tree, fileTree, '');
    }

    buildFileTree(items) {
        const tree = { folders: {}, files: [] };
        
        items.forEach(item => {
            const parts = item.path.split(/[/\\]/);
            
            if (item.is_dir) {
                // Add folder to tree
                let current = tree;
                parts.forEach((part, idx) => {
                    if (!current.folders[part]) {
                        current.folders[part] = { folders: {}, files: [], path: parts.slice(0, idx + 1).join('/') };
                    }
                    current = current.folders[part];
                });
            } else {
                // Add file to appropriate folder or root
                if (parts.length === 1) {
                    tree.files.push(item);
                } else {
                    let current = tree;
                    for (let i = 0; i < parts.length - 1; i++) {
                        const part = parts[i];
                        if (!current.folders[part]) {
                            current.folders[part] = { folders: {}, files: [], path: parts.slice(0, i + 1).join('/') };
                        }
                        current = current.folders[part];
                    }
                    current.files.push(item);
                }
            }
        });
        
        return tree;
    }

    renderFileTree(node, container, indent = '') {
        // Render folders first
        Object.keys(node.folders).sort().forEach(folderName => {
            const folder = node.folders[folderName];
            const folderItem = document.createElement('div');
            folderItem.className = 'file-item folder-item';
            folderItem.setAttribute('data-path', folder.path);
            folderItem.innerHTML = `
                <i class="fas fa-chevron-right folder-chevron"></i>
                <i class="fas fa-folder"></i>
                <span>${folderName}</span>
                <i class="fas fa-trash delete-icon" title="Delete folder"></i>
            `;
            
            // Create nested container for children
            const childContainer = document.createElement('div');
            childContainer.className = 'folder-children collapsed';
            
            // Delete button handler
            const deleteBtn = folderItem.querySelector('.delete-icon');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteFolder(folder.path);
            });
            
            // Toggle expand/collapse on click
            folderItem.addEventListener('click', (e) => {
                e.stopPropagation();
                // Don't toggle if clicking delete button
                if (e.target.classList.contains('delete-icon')) return;
                
                const isExpanded = !childContainer.classList.contains('collapsed');
                
                if (isExpanded) {
                    childContainer.classList.add('collapsed');
                    folderItem.querySelector('.folder-chevron').classList.remove('expanded');
                } else {
                    childContainer.classList.remove('collapsed');
                    folderItem.querySelector('.folder-chevron').classList.add('expanded');
                }
            });
            
            // Right-click to toggle active folder for new files
            folderItem.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                
                // If already active, deactivate
                if (folderItem.classList.contains('active-folder')) {
                    this.currentFolder = null;
                    this.showNotification('Folder deactivated', 'info');
                    folderItem.classList.remove('active-folder');
                } else {
                    // Activate this folder
                    this.currentFolder = folder.path;
                    this.showNotification(`Active folder: ${folder.path}`, 'info');
                    // Visual feedback
                    document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('active-folder'));
                    folderItem.classList.add('active-folder');
                }
            });
            
            container.appendChild(folderItem);
            
            // Render children recursively
            this.renderFileTree(folder, childContainer, indent + '  ');
            container.appendChild(childContainer);
        });
        
        // Then render files
        node.files.sort((a, b) => a.name.localeCompare(b.name)).forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                <i class="fas fa-file-code"></i>
                <span>${file.name}</span>
                <i class="fas fa-share-nodes share-icon" title="Share this file"></i>
                <i class="fas fa-trash delete-icon" title="Delete file"></i>
            `;
            
            // Share button handler
            const shareBtn = fileItem.querySelector('.share-icon');
            shareBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.createShareLink(file.path);
            });
            
            // Delete button handler
            const deleteBtn = fileItem.querySelector('.delete-icon');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteFile(file.path);
            });
            
            fileItem.addEventListener('click', (e) => {
                // Don't open if clicking share or delete button
                if (e.target.classList.contains('delete-icon') || e.target.classList.contains('share-icon')) return;
                this.openFile(file.path);
            });
            container.appendChild(fileItem);
        });
    }

    async openFile(filePath) {
        // Normalize path (forward slashes, no leading/trailing slashes)
        filePath = filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        console.log('Opening file:', filePath);
        
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
                this.openFiles.set(filePath, {
                    content: data.content,
                    modified: false
                });
                
                this.addFileTab(filePath);
                this.loadFileContent(data.content);
                this.currentFile = filePath;
                // Auto switch editor language based on file extension
                this.applyLanguageFromFile(filePath);
                console.log('File opened successfully, currentFile set to:', this.currentFile);
            }
        } catch (error) {
            console.error('Failed to open file:', error);
        }
    }

    addFileTab(filePath) {
        const tabsContainer = document.getElementById('fileTabs');
        
        const tab = document.createElement('div');
        tab.className = 'file-tab';
        tab.setAttribute('data-file', filePath);
        tab.setAttribute('title', filePath); // Full path in tooltip
        tab.innerHTML = `
            <i class="fas fa-file-code"></i>
            <span>${filePath}</span>
            <i class="fas fa-share-nodes share-icon" title="Share this file"></i>
            <button class="close-btn">&times;</button>
        `;
        
        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('close-btn') && !e.target.classList.contains('share-icon')) {
                this.switchToFile(filePath);
            }
        });
        
        tab.querySelector('.share-icon').addEventListener('click', (e) => {
            e.stopPropagation();
            this.createShareLink(filePath);
        });
        
        tab.querySelector('.close-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeFile(filePath);
        });
        
        tabsContainer.appendChild(tab);
        this.updateActiveTab(tab);
    }

    switchToFile(filePath) {
        // Normalize path
        filePath = filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        const fileData = this.openFiles.get(filePath);
        if (fileData) {
            this.loadFileContent(fileData.content);
            this.currentFile = filePath;
            const tab = document.querySelector(`[data-file="${filePath}"]`);
            if (tab) {
                this.updateActiveTab(tab);
            }
            // Auto switch language when switching tabs
            this.applyLanguageFromFile(filePath);
        }
    }

    loadFileContent(content) {
        this.editor.setValue(content, -1); // -1 moves cursor to end
        this.editor.session.getUndoManager().reset(); // Clear undo history
    }

    updateActiveTab(activeTab) {
        document.querySelectorAll('.file-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        activeTab.classList.add('active');
    }

    closeFile(filePath) {
        // Normalize path
        filePath = filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        this.openFiles.delete(filePath);
        
        // Remove tab
        const tab = document.querySelector(`[data-file="${filePath}"]`);
        if (tab) {
            tab.remove();
        }
        
        // If this was the current file, switch to another open file or clear editor
        if (this.currentFile === filePath) {
            // Try to switch to another open file
            const remainingFiles = Array.from(this.openFiles.keys());
            if (remainingFiles.length > 0) {
                this.switchToFile(remainingFiles[0]);
            } else {
                this.editor.setValue('');
                this.currentFile = null;
            }
        }
    }

    async saveCurrentFile() {
        console.log('Save attempt - currentFile:', this.currentFile, 'currentProject:', this.currentProject);
        
        if (!this.currentFile || !this.currentProject) {
            this.showNotification('No file to save', 'error');
            console.error('Save failed - missing currentFile or currentProject');
            return;
        }
        
        const content = this.editor.getValue();
        
        try {
            const response = await fetch('/api/files/save', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    project_name: this.currentProject,
                    file_path: this.currentFile,
                    content: content
                })
            });
            
            if (response.ok) {
                this.showNotification('File saved successfully', 'success');
                // Update the cached content so we don't need to reload from server
                const fileData = this.openFiles.get(this.currentFile);
                if (fileData) {
                    fileData.content = content;
                    fileData.modified = false;
                }
            } else {
                this.showNotification('Failed to save file', 'error');
            }
        } catch (error) {
            console.error('Failed to save file:', error);
            this.showNotification('Failed to save file', 'error');
        }
    }

    async runCode() {
        const code = this.editor.getValue();
        const language = document.getElementById('languageSelect').value;
        
        if (!code.trim()) {
            this.showNotification('Please write some code first!', 'error');
            return;
        }
        
        if (!this.ws || (this.ws.readyState !== WebSocket.OPEN)) {
            // establish connection and run once it opens
            this.shouldAutoRunOnce = true;
            this.connectWebSocket();
            return;
        }
        
        this.isRunning = true;
        this.updateRunButton();
        this.clearTerminal();
        this.fitTerminal();
        this.focusTerminal();
        
            // Send code to run
        this.ws.send(`RUN ${language} ${code}`);
    }

    connectWebSocket() {
        // Prevent duplicate connections
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        if (this.wsConnecting) return;
        this.wsConnecting = true;

        this.ws = new WebSocket('ws://' + location.host + '/api/terminal');
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.fitTerminal();
            this.focusTerminal();
            this.wsConnecting = false;
            if (this.shouldAutoRunOnce) {
                // reset flag and trigger the pending run
                this.shouldAutoRunOnce = false;
                this.runCode();
            }
        };
        
        this.ws.onclose = (ev) => {
            console.log('WebSocket disconnected');
            this.appendToTerminal(`🔴 WS closed (code=${ev.code}${ev.reason ? ", reason=" + ev.reason : ''})\n`, 'error');
            this.wsConnecting = false;
            this.ws = null;
            this.terminalInputBuffer = '';
            if (this.isRunning) {
                this.appendToTerminal('🔴 Connection lost. Please run again.\n', 'error');
                this.isRunning = false;
                this.updateRunButton();
            }
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.appendToTerminal('🔴 WebSocket error. Please check console.\n', 'error');
            this.wsConnecting = false;
            this.isRunning = false;
            this.updateRunButton();
            this.terminalInputBuffer = '';
        };
        
        this.ws.onmessage = (event) => {
            // Ignore backend handshake noise
            if (typeof event.data === 'string' && event.data.trim() === 'BLACKMOON_WS_READY') {
                return;
            }

            if (event.data === "<<EXECUTION_COMPLETE>>") {
                this.isRunning = false;
                this.updateRunButton();
                return;
            }
            
            // Fallback detection: mark complete/stopped based on message text
            if (typeof event.data === 'string') {
                const msg = event.data;
                if (msg.includes('Execution completed') ||
                    msg.includes('Process exited with code') ||
                    msg.includes('Execution timeout') ||
                    msg.includes('Execution stopped')) {
                    this.isRunning = false;
                    this.updateRunButton();
                }
            }

            this.appendToTerminal(event.data);
        };
    }

    stopExecution() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send('STOP');
                this.appendToTerminal('🛑 Stopping...\n');
            } catch (e) {
                console.error('Failed to send STOP:', e);
            }
        }
        // Optimistically update UI; backend will send completion token or stop message
        this.isRunning = false;
        this.updateRunButton();
    }

    updateRunButton() {
        const runButton = document.getElementById('runButton');
        if (this.isRunning) {
            runButton.innerHTML = '<i class="fas fa-stop"></i> Stop';
            runButton.className = 'btn btn-danger';
        } else {
            runButton.innerHTML = '<i class="fas fa-play"></i> Run';
            runButton.className = 'btn btn-success';
        }
    }

    appendToTerminal(text, className = '') {
        if (!this.xterm && typeof Terminal !== 'undefined') {
            this.initTerminal();
        }

        if (!this.xterm) {
            console.log('[Terminal]', text);
            return;
        }

        let message = '';
        if (typeof text === 'string') {
            message = text;
        } else if (text instanceof Blob) {
            text.text().then((value) => this.appendToTerminal(value, className));
            return;
        } else if (text instanceof ArrayBuffer && this.textDecoder) {
            message = this.textDecoder.decode(text);
        } else if (text && typeof text === 'object' && 'toString' in text) {
            message = text.toString();
        } else if (text != null) {
            message = String(text);
        }

        const normalized = message.replace(/\r?\n/g, '\r\n');

        if (className === 'error') {
            this.xterm.write(`\u001b[31m${normalized}\u001b[0m`);
        } else {
            this.xterm.write(normalized);
        }
    }

    clearTerminal() {
        if (this.xterm) {
            if (typeof this.xterm.reset === 'function') {
                this.xterm.reset();
            } else {
                this.xterm.clear();
            }
            this.terminalInputBuffer = '';
            this.fitTerminal();
            this.focusTerminal();
        }
    }

    toggleTerminal() {
        const terminalPanel = document.querySelector('.terminal-panel');
        const toggleBtn = document.getElementById('toggleTerminalBtn');
        const resizer = document.getElementById('terminalResizer');

        if (!terminalPanel) {
            return;
        }

        if (terminalPanel.classList.contains('collapsed')) {
            terminalPanel.classList.remove('collapsed');
            if (resizer) {
                resizer.classList.remove('inactive');
                resizer.setAttribute('tabindex', '0');
            }
            const height = this.terminalPreferredHeight != null
                ? this.terminalPreferredHeight
                : (this._loadTerminalHeight() || 250);
            this.setTerminalHeight(height, { persist: false });
            if (toggleBtn) {
                toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
            }
            this.fitTerminal();
            this.focusTerminal();
            try { this.editor && this.editor.resize(true); } catch (_) {}
            return;
        }

        const currentHeight = this._getCurrentTerminalHeight();
        if (currentHeight) {
            this.terminalPreferredHeight = currentHeight;
            localStorage.setItem('terminalPanelHeight', String(currentHeight));
        }

        terminalPanel.classList.add('collapsed');
        terminalPanel.style.flex = '0 0 40px';
        terminalPanel.style.height = '40px';
        if (toggleBtn) {
            toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
        }
        if (resizer) {
            resizer.classList.add('inactive');
            resizer.setAttribute('tabindex', '-1');
        }
        try { this.editor && this.editor.resize(true); } catch (_) {}
    }

    async explainCode() {
        const code = this.editor.getValue();
        const language = document.getElementById('languageSelect').value;
        
        if (!code.trim()) {
            this.showNotification('Please write some code first!', 'error');
            return;
        }
        
        // Show loading indicator
        const explainBtn = document.getElementById('explainButton');
        const originalHTML = explainBtn.innerHTML;
        explainBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        explainBtn.disabled = true;
        
        // Check if we have cached explanation for this code
        const cacheKey = `${language}:${code}`;
        if (this.explanationCache && this.explanationCache.key === cacheKey) {
            this.showAIExplanation(this.explanationCache.data);
            explainBtn.innerHTML = originalHTML;
            explainBtn.disabled = false;
            return;
        }
        
        // Get current active explanation type
        const activeTab = document.querySelector('.tab-btn.active');
        const explanationType = activeTab ? activeTab.dataset.tab : 'comprehensive';
        
        try {
            const response = await fetch('/api/ai/explain', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    code: code,
                    language: language,
                    explanation_type: explanationType
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                
                // Cache the explanation
                this.explanationCache = {
                    key: cacheKey,
                    data: data,
                    timestamp: Date.now()
                };
                
                this.showAIExplanation(data);
            } else {
                const error = await response.json();
                this.showNotification(error.detail || 'Failed to generate explanation', 'error');
            }
        } catch (error) {
            console.error('Failed to explain code:', error);
            this.showNotification('Failed to generate explanation', 'error');
        } finally {
            explainBtn.innerHTML = originalHTML;
            explainBtn.disabled = false;
        }
    }

    showAIExplanation(data) {
        const content = document.getElementById('explanationContent');
        
        // Store only the comprehensive explanation initially
        // Other tabs will be generated on demand
        this.currentExplanations = {
            'comprehensive': data.explanation
        };
        
        // Show the comprehensive explanation by default
        content.innerHTML = '<div class="explanation-wrapper">' + this.formatMarkdown(data.explanation) + '</div>';
        this.showModal('aiModal');
    }

    switchExplanationTab(tabType) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const clickedTab = document.querySelector(`[data-tab="${tabType}"]`);
        if (clickedTab) {
            clickedTab.classList.add('active');
        }
        
        const content = document.getElementById('explanationContent');
        
        // Check if we already have this explanation type cached
        if (this.currentExplanations && this.currentExplanations[tabType]) {
            // Show cached content
            content.innerHTML = '<div class="explanation-wrapper">' + this.formatMarkdown(this.currentExplanations[tabType]) + '</div>';
        } else {
            // Generate new explanation for this type
            this.regenerateExplanation(tabType);
        }
    }

    async regenerateExplanation(explanationType) {
        const code = this.editor.getValue();
        const language = document.getElementById('languageSelect').value;
        const content = document.getElementById('explanationContent');
        
        // Show loading
        content.innerHTML = '<div class="loading-container"><i class="fas fa-spinner fa-spin"></i><p>Generating ' + explanationType + ' explanation...</p></div>';
        
        try {
            // Convert kebab-case to snake_case (line-by-line -> line_by_line)
            const apiExplanationType = explanationType.replace(/-/g, '_');
            
            const response = await fetch('/api/ai/explain', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    code: code,
                    language: language,
                    explanation_type: apiExplanationType
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.currentExplanations[explanationType] = data.explanation;
                content.innerHTML = '<div class="explanation-wrapper">' + this.formatMarkdown(data.explanation) + '</div>';
            } else {
                content.innerHTML = '<div class="error">Failed to generate explanation. Please try again.</div>';
            }
        } catch (error) {
            console.error('Failed to explain code:', error);
            content.innerHTML = '<div class="error">Failed to generate explanation. Please try again.</div>';
        }
    }

    formatMarkdown(text) {
        // Enhanced markdown to HTML conversion
        // 1) Normalize line endings and trim
        let t = (text || '').replace(/\r\n/g, '\n').trim();
        // 2) Strip leading/trailing horizontal rules like --- that models often add
        t = t.replace(/^(?:---+\s*\n)+/g, '').replace(/(?:\n---+\s*)+$/g, '');
        // 3) Convert markdown to HTML
        return t
            // Horizontal rules
            .replace(/^---+\s*$/gim, '<hr>')
            // Code blocks (must be before inline code)
            .replace(/```[\w]*\n([\s\S]*?)```/gim, '<pre><code>$1</code></pre>')
            // Headers
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            // Bold
            .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
            // Italic
            .replace(/\*(.*?)\*/gim, '<em>$1</em>')
            // Markdown links [text](url)
            .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>')
            // Plain URLs (https?://)
            .replace(/(?<!href="|src=")(https?:\/\/[^\s<]+)/gim, '<a href="$1" target="_blank">$1</a>')
            // Inline code
            .replace(/`([^`]+)`/gim, '<code>$1</code>')
            // Lists (unordered)
            .replace(/^\* (.+)$/gim, '<li>$1</li>')
            .replace(/^- (.+)$/gim, '<li>$1</li>')
            // Line breaks
            .replace(/\n\n/gim, '</p><p>')
            .replace(/\n/gim, '<br>');
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
        
        // Pre-fill path if a folder is selected
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
                body: JSON.stringify({
                    project_name: projectName
                })
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
        
        // If a folder is selected and filename doesn't include path, prepend folder
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
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (response.ok) {
                this.showNotification('File deleted successfully', 'success');
                
                // Close tab if file is currently open
                if (this.currentFile === filePath) {
                    this.closeFile(filePath);
                } else if (this.openFiles.has(filePath)) {
                    // Remove from open files
                    this.openFiles.delete(filePath);
                    // Remove tab
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
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
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

    async formatCode() {
        const code = this.editor.getValue();
        const language = document.getElementById('languageSelect').value;
        
        if (!code.trim()) {
            this.showNotification('No code to format', 'warning');
            return;
        }

        const formatBtn = document.getElementById('formatButton');
        const originalHTML = formatBtn.innerHTML;
        formatBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Formatting...';
        formatBtn.disabled = true;

        try {
            const response = await fetch('/api/format', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    code: code,
                    language: language
                })
            });

            if (response.ok) {
                const data = await response.json();
                
                if (data.success) {
                    if (data.changed) {
                        // Preserve cursor position
                        const cursor = this.editor.getCursorPosition();
                        this.editor.setValue(data.code, -1); // -1 moves cursor to start
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

    async showSettings() {
        this.showModal('settingsModal');
        
        // Load AI status
        try {
            const response = await fetch('/api/ai/status', {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.updateAIStatus(data);
            }
        } catch (error) {
            console.error('Failed to load AI status:', error);
        }
    }

    updateAIStatus(status) {
        const statusDiv = document.getElementById('aiStatus');
        const modeIcon = status.ai_mode === 'gemini' ? '✅' : '⚠️';
        const modeText = status.ai_mode === 'gemini' ? 'Gemini AI Active' : 'Fallback Mode (Template-based)';
        const apiStatus = status.api_key_configured ? '🔑 API Key Configured' : '❌ No API Key';
        
        statusDiv.innerHTML = `
            <div class="status-info">
                <p><strong>AI Mode:</strong> ${modeIcon} ${modeText}</p>
                <p><strong>Status:</strong> ${apiStatus}</p>
                ${!status.api_key_configured ? '<p class="warning">⚠️ Configure your Gemini API key for AI-powered explanations</p>' : ''}
            </div>
        `;
    }

    async updateApiKey() {
        const apiKey = document.getElementById('geminiApiKey').value;
        
        if (!apiKey.trim()) {
            this.showNotification('Please enter an API key', 'error');
            return;
        }
        
        try {
            const response = await fetch('/api/ai/update-key', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ api_key: apiKey })
            });
            
            if (response.ok) {
                this.showNotification('API key updated successfully! AI features are now enabled.', 'success');
                this.hideModal('settingsModal');
                document.getElementById('geminiApiKey').value = '';
            } else {
                const error = await response.json();
                this.showNotification(error.detail || 'Failed to update API key', 'error');
            }
        } catch (error) {
            console.error('Failed to update API key:', error);
            this.showNotification('Failed to update API key', 'error');
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Style the notification
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        
        // Set background color based on type
        const colors = {
            success: '#4caf50',
            error: '#f44336',
            warning: '#ff9800',
            info: '#2196f3'
        };
        notification.style.backgroundColor = colors[type] || colors.info;
        
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.remove();
        }, 3000);
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
                body: JSON.stringify({
                    code: code,
                    language: language,
                    filename: this.currentFile || `temp.${language}`
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this.displayErrors(data.errors);
                } else {
                    // Linting not supported for this language
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
        const errorCount = document.getElementById('errorCount');
        const warningCount = document.getElementById('warningCount');

        // Clear previous errors
        errorList.innerHTML = '';
        this.clearEditorMarkers();

        if (errors.length === 0) {
            errorPanel.classList.remove('show');
            return;
        }

        // Count errors and warnings
        const errCount = errors.filter(e => e.severity === 'error').length;
        const warnCount = errors.filter(e => e.severity === 'warning').length;
        
        errorCount.textContent = errCount;
        warningCount.textContent = warnCount;

        // Display errors in panel
        errors.forEach(error => {
            const li = document.createElement('li');
            li.className = 'error-item';
            li.innerHTML = `
                <i class="fas ${error.severity === 'error' ? 'fa-times-circle' : 'fa-exclamation-triangle'} error-icon ${error.severity}"></i>
                <div class="error-details">
                    <div class="error-message">
                        ${error.message}
                        ${error.code ? `<span class="error-code">[${error.code}]</span>` : ''}
                    </div>
                    <div class="error-location">
                        Line ${error.line}, Column ${error.column} • ${error.source || 'linter'}
                    </div>
                </div>
            `;
            
            // Jump to error line on click
            li.addEventListener('click', () => {
                this.editor.gotoLine(error.line, error.column - 1, true);
                this.editor.focus();
            });
            
            errorList.appendChild(li);

            // Add annotation (marker) to editor
            this.addEditorMarker(error.line - 1, error.severity, error.message);
        });

        errorPanel.classList.add('show');
    }

    addEditorMarker(line, severity, message) {
        // Ace uses annotations for error/warning markers
        if (!this.editorAnnotations) {
            this.editorAnnotations = [];
        }
        
        this.editorAnnotations.push({
            row: line,
            column: 0,
            text: message,
            type: severity // "error" or "warning"
        });
        
        this.editor.session.setAnnotations(this.editorAnnotations);
    }

    clearEditorMarkers() {
        this.editorAnnotations = [];
        this.editor.session.clearAnnotations();
    }

    clearErrors() {
        const errorPanel = document.getElementById('errorPanel');
        errorPanel.classList.remove('show');
        this.clearEditorMarkers();
    }

    logout() {
        localStorage.removeItem('authToken');
        window.location.href = '/';
    }

    // ===== Auto language switching helpers =====
    detectLanguageFromFile(filePath) {
        if (!filePath) return null;
        const ext = filePath.split('.').pop().toLowerCase();
        switch (ext) {
            case 'py': return 'python';
            case 'c': return 'c';
            case 'cpp':
            case 'cc':
            case 'cxx': return 'cpp';
            case 'java': return 'java';
            case 'js': return 'javascript';
            case 'go': return 'go';
            case 'rs': return 'rust';
            case 'json': return 'json';
            default: return null;
        }
    }

    applyLanguageFromFile(filePath) {
        const lang = this.detectLanguageFromFile(filePath);
        if (!lang) return;
        const langSel = document.getElementById('languageSelect');
        if (langSel && langSel.value !== lang) {
            langSel.value = lang;
        }
        this.setEditorMode(lang);
        // Re-lint with new language context
        this.lintCode();
    }

    // ===== Profile and Sharing Methods =====
    
    toggleProfileMenu() {
        const menu = document.getElementById('profileMenu');
        menu.classList.toggle('show');
    }
    
    hideProfileMenu() {
        const menu = document.getElementById('profileMenu');
        menu.classList.remove('show');
    }
    
    async loadUserProfile() {
        try {
            const response = await fetch('/api/profile', {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            
            if (response.ok) {
                this.userProfile = await response.json();
                this.updateProfileUI();
            }
        } catch (error) {
            console.error('Failed to load profile:', error);
        }
    }
    
    updateProfileUI() {
        if (!this.userProfile) return;
        
        // Update profile avatars
        const avatars = ['profileAvatar', 'profileAvatarLarge'];
        avatars.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (this.userProfile.profile_picture) {
                    el.innerHTML = `<img src="${this.userProfile.profile_picture}" alt="${this.userProfile.username}">`;
                } else {
                    el.innerHTML = `<i class="fas fa-user"></i>`;
                }
            }
        });
        
        // Update profile menu header
        const usernameEl = document.getElementById('profileUsername');
        const emailEl = document.getElementById('profileEmail');
        if (usernameEl) usernameEl.textContent = this.userProfile.username;
        if (emailEl) emailEl.textContent = this.userProfile.email;
    }
    
    async showProfile() {
        this.showModal('profileModal');
        
        if (!this.userProfile) {
            await this.loadUserProfile();
        }
        
        if (this.userProfile) {
            document.getElementById('profileUsernameDisplay').value = this.userProfile.username;
            document.getElementById('profileEmailDisplay').value = this.userProfile.email;
            const bioTextarea = document.getElementById('profileBio');
            bioTextarea.value = this.userProfile.bio || '';
            
            // Update character counter
            this.updateBioCounter();
            
            // Add input listener for character counter
            bioTextarea.removeEventListener('input', this.updateBioCounter.bind(this));
            bioTextarea.addEventListener('input', this.updateBioCounter.bind(this));
            
            const preview = document.getElementById('profilePicPreview');
            if (this.userProfile.profile_picture) {
                preview.innerHTML = `<img src="${this.userProfile.profile_picture}" alt="${this.userProfile.username}">`;
            } else {
                preview.innerHTML = `<i class="fas fa-user"></i>`;
            }
        }
    }
    
    updateBioCounter() {
        const bioTextarea = document.getElementById('profileBio');
        const counter = document.getElementById('bioCharCount');
        if (bioTextarea && counter) {
            counter.textContent = bioTextarea.value.length;
        }
    }
    
    handleProfilePictureUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.type.startsWith('image/')) {
            this.showNotification('Please select an image file', 'error');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const imageData = e.target.result;
            const preview = document.getElementById('profilePicPreview');
            preview.innerHTML = `<img src="${imageData}" alt="Profile">`;
            
            // Store for later upload
            this.pendingProfilePicture = imageData;
        };
        reader.readAsDataURL(file);
    }
    
    async updateProfile() {
        const bio = document.getElementById('profileBio').value;
        
        try {
            const response = await fetch('/api/profile/update', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    profile_picture: this.pendingProfilePicture || this.userProfile.profile_picture,
                    bio: bio
                })
            });
            
            if (response.ok) {
                this.showNotification('Profile updated successfully', 'success');
                this.hideModal('profileModal');
                await this.loadUserProfile();
                this.pendingProfilePicture = null;
            } else {
                const error = await response.json();
                this.showNotification(error.detail || 'Failed to update profile', 'error');
            }
        } catch (error) {
            console.error('Failed to update profile:', error);
            this.showNotification('Failed to update profile', 'error');
        }
    }
    
    async showMyShares() {
        this.showModal('mySharesModal');
        await this.loadMyShares();
    }
    
    async loadMyShares() {
        try {
            const response = await fetch('/api/share/list', {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.renderShares(data.shares);
            }
        } catch (error) {
            console.error('Failed to load shares:', error);
            this.showNotification('Failed to load shared files', 'error');
        }
    }
    
    renderShares(shares) {
        const container = document.getElementById('sharesList');
        
        if (Object.keys(shares).length === 0) {
            container.innerHTML = `
                <div class="empty-shares">
                    <i class="fas fa-share-alt fa-3x"></i>
                    <p>No shared files yet</p>
                    <p style="font-size: 14px;">Share a file by clicking the share icon on any file</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = Object.entries(shares).map(([shareId, info]) => `
            <div class="share-item">
                <div class="share-info">
                    <h4><i class="fas fa-file-code"></i> ${info.file_path}</h4>
                    <p>Project: ${info.project} • Created: ${new Date(info.created_at).toLocaleDateString()}</p>
                </div>
                <div class="share-actions">
                    <button class="btn btn-sm btn-primary" onclick="compiler.viewShare('${shareId}')">
                        <i class="fas fa-external-link-alt"></i> View
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="compiler.copyShareUrl('${shareId}')">
                        <i class="fas fa-copy"></i> Copy Link
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="compiler.deleteShare('${shareId}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }
    
    async createShareLink(filePath) {
        if (!this.currentProject) {
            this.showNotification('Please open a project first', 'error');
            return;
        }
        
        // Normalize path
        filePath = filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        
        try {
            const response = await fetch('/api/share/create', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    project_name: this.currentProject,
                    file_path: filePath
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.showShareLinkModal(data.share_id);
            } else {
                const error = await response.json();
                this.showNotification(error.detail || 'Failed to create share link', 'error');
            }
        } catch (error) {
            console.error('Failed to create share link:', error);
            this.showNotification('Failed to create share link', 'error');
        }
    }
    
    showShareLinkModal(shareId) {
        const shareUrl = `${window.location.origin}/share/${shareId}`;
        document.getElementById('shareLinkInput').value = shareUrl;
        this.showModal('shareLinkModal');
    }
    
    copyShareLink() {
        const input = document.getElementById('shareLinkInput');
        input.select();
        document.execCommand('copy');
        this.showNotification('Share link copied to clipboard', 'success');
    }
    
    viewShare(shareId) {
        window.open(`/share/${shareId}`, '_blank');
    }
    
    copyShareUrl(shareId) {
        const shareUrl = `${window.location.origin}/share/${shareId}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
            this.showNotification('Share link copied to clipboard', 'success');
        });
    }
    
    async deleteShare(shareId) {
        if (!confirm('Are you sure you want to delete this shared link?')) return;
        
        try {
            const response = await fetch(`/api/share/${shareId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            
            if (response.ok) {
                this.showNotification('Share link deleted', 'success');
                await this.loadMyShares();
            } else {
                const error = await response.json();
                this.showNotification(error.detail || 'Failed to delete share link', 'error');
            }
        } catch (error) {
            console.error('Failed to delete share:', error);
            this.showNotification('Failed to delete share link', 'error');
        }
    }
    
    // ===== AI Chat Methods =====
    
    showAiChat() {
        this.showModal('aiChatModal');
        // Initialize chat if first time
        if (!this.chatInitialized) {
            this.chatInitialized = true;
            this.chatMessages = [];
        }
    }
    
    async sendChatMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        
        if (!message) return;
        
        // Get context selections
        const contextCurrentFile = document.getElementById('contextCurrentFile').checked;
        const contextProject = document.getElementById('contextProject').checked;
        const contextTerminal = document.getElementById('contextTerminal').checked;
        
        // Clear input
        input.value = '';
        
        // Add user message to chat
        this.addChatMessage('user', message, {
            currentFile: contextCurrentFile,
            project: contextProject,
            terminal: contextTerminal
        });
        
        // Show typing indicator
        this.showTypingIndicator();
        
        try {
            // Get terminal output if needed
            let terminalOutput = '';
            if (contextTerminal) {
                terminalOutput = this.getTerminalText();
            }
            
            const response = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    context_current_file: contextCurrentFile,
                    context_project: contextProject,
                    context_terminal: contextTerminal,
                    current_file_content: this.editor.getValue(),
                    current_file_path: this.currentFile || '',
                    project_name: this.currentProject || '',
                    terminal_output: terminalOutput
                })
            });
            
            this.removeTypingIndicator();
            
            if (response.ok) {
                const data = await response.json();
                this.addChatMessage('ai', data.response);
            } else {
                const error = await response.json();
                this.addChatMessage('ai', error.detail || 'Sorry, I encountered an error.');
            }
        } catch (error) {
            console.error('Failed to send chat message:', error);
            this.removeTypingIndicator();
            this.addChatMessage('ai', 'Sorry, I could not connect to the AI service.');
        }
    }
    
    addChatMessage(type, content, context = null) {
        const messagesContainer = document.getElementById('chatMessages');
        
        // Remove welcome message if present
        const welcome = messagesContainer.querySelector('.chat-welcome');
        if (welcome) welcome.remove();
        
        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${type}`;
        
        let contextBadges = '';
        if (context && type === 'user') {
            const badges = [];
            if (context.currentFile) badges.push('<span class="context-badge"><i class="fas fa-file-code"></i> Current File</span>');
            if (context.project) badges.push('<span class="context-badge"><i class="fas fa-folder"></i> Project</span>');
            if (context.terminal) badges.push('<span class="context-badge"><i class="fas fa-terminal"></i> Terminal</span>');
            if (badges.length > 0) {
                contextBadges = `<div class="chat-message-context">${badges.join('')}</div>`;
            }
        }
        
        const avatar = type === 'user' ? 
            '<i class="fas fa-user"></i>' : 
            '<i class="fas fa-robot"></i>';
        
        // Format code blocks in AI responses
        let formattedContent = content;
        if (type === 'ai') {
            // Convert markdown code blocks to HTML
            formattedContent = content.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
            formattedContent = formattedContent.replace(/`([^`]+)`/g, '<code>$1</code>');
        }
        
        messageEl.innerHTML = `
            <div class="chat-message-avatar">${avatar}</div>
            <div class="chat-message-content">
                ${contextBadges}
                ${formattedContent}
            </div>
        `;
        
        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    showTypingIndicator() {
        const messagesContainer = document.getElementById('chatMessages');
        const typingEl = document.createElement('div');
        typingEl.className = 'chat-message ai typing-indicator';
        typingEl.innerHTML = `
            <div class="chat-message-avatar"><i class="fas fa-robot"></i></div>
            <div class="chat-message-content">
                <div class="chat-typing">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        messagesContainer.appendChild(typingEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    removeTypingIndicator() {
        const typingIndicator = document.querySelector('.typing-indicator');
        if (typingIndicator) typingIndicator.remove();
    }
}

// Initialize the application when DOM is loaded
let compiler; // Global reference for inline handlers
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

