
class BlackMoonCompiler {
    constructor() {
        // Core properties
        this.editor = null;
        this.currentProject = null;
        this.currentFile = null;
        this.openFiles = new Map();
        this.authToken = localStorage.getItem('authToken');
        this.fontSize = this._loadFontSize();
        this.currentFolder = null;
        
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
        
        // Load projects
        await this.loadProjects();
        
        // Setup event listeners
        this.setupEventListeners();
        
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
            enableSnippets: true,
            showPrintMargin: false,
            fontSize: `${this.fontSize}px`,
            fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
            tabSize: 4,
            useSoftTabs: true,
            wrap: false,
            showGutter: true,
            highlightActiveLine: true,
        });

        // Keyboard shortcuts for save and run
        this.editor.commands.addCommand({
            name: 'save',
            bindKey: {win: 'Ctrl-S', mac: 'Command-S'},
            exec: () => this.saveCurrentFile()
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            this.editor && this.editor.resize(true);
        });
    }

    setupEventListeners() {
        // Project selector
        document.getElementById('projectSelect').addEventListener('change', (e) => {
            if (e.target.value) {
                this.loadProject(e.target.value);
            }
        });

        // Save button
        document.getElementById('saveButton').addEventListener('click', () => this.saveCurrentFile());
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
        // Load file content from server
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

