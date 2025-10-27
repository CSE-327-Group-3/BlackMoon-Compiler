
class BlackMoonCompiler {
    constructor() {
        // Core properties
        this.editor = null;
        this.currentProject = null;
        this.currentFile = null;
        this.openFiles = new Map();
        this.authToken = localStorage.getItem('authToken');
        
        this.init();
    }

    async init() {
        // Check authentication
        if (!this.authToken) {
            window.location.href = '/';
            return;
        }

        console.log('BlackMoon Compiler initializing...');
    }
}

// Initialize when DOM is ready
let compiler;
document.addEventListener('DOMContentLoaded', () => {
    compiler = new BlackMoonCompiler();
});

