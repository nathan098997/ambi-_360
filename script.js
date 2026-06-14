// AMBI360 - Versão Standalone com IndexedDB (sem limite de tamanho)
const STORAGE_KEY = 'ambi360_projects';
const TRASH_KEY = 'ambi360_trash';
const DB_NAME = 'AMBI360_DB';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

let db = null;
let trashedProjects = {};

// Sistema de persistência de estado
const STATE_KEY = 'ambi360_app_state';

// Salvar estado atual
function saveAppState() {
    const state = {
        isLoggedIn: document.getElementById('loginContainer').classList.contains('hidden'),
        isAdminPanel: !document.getElementById('adminPanel').classList.contains('hidden'),
        isViewer: !document.getElementById('viewerContainer').classList.contains('hidden'),
        currentSection: getCurrentSection(),
        currentProject: currentProjectName,
        editingProject: editingProjectName,
        timestamp: Date.now()
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    console.log('💾 Estado salvo:', state);
}

// Carregar estado salvo
function loadAppState() {
    try {
        const saved = localStorage.getItem(STATE_KEY);
        return saved ? JSON.parse(saved) : null;
    } catch (e) {
        return null;
    }
}

// Detectar seção atual
function getCurrentSection() {
    if (!document.getElementById('projectsSection').classList.contains('hidden')) return 'projects';
    if (!document.getElementById('createSection').classList.contains('hidden')) return 'create';
    if (!document.getElementById('trashSection').classList.contains('hidden')) return 'trash';
    return 'projects';
}

// Restaurar estado após carregamento
function restoreAppState() {
    const state = loadAppState();
    if (!state) return;
    
    // Se estava no viewer
    if (state.isViewer && state.currentProject && projects[state.currentProject]) {
        setTimeout(() => {
            showViewer(state.currentProject);
        }, 100);
        return; // Importante: sair aqui para não executar o resto
    }
    
    // Se estava logado no admin
    if (state.isAdminPanel) {
        showAdminPanel();
        showSection(state.currentSection);
        
        // Se estava editando um projeto
        if (state.editingProject && state.currentSection === 'create') {
            setTimeout(() => {
                if (projects[state.editingProject]) {
                    editProject(state.editingProject);
                }
            }, 100);
        }
    }
}

const DEFAULT_PROJECTS = {
    'projeto-demo': {
        image: 'https://pannellum.org/images/alma.jpg',
        title: 'Projeto Demo',
        createdAt: new Date().toISOString(),
        hotspots: []
    }
};

let projects = {};
let viewer = null;
let previewViewer = null;
let hotspots = [];
let addingHotspot = false;
let currentParentId = null;
let previewCurrentImage = null;
let previewRootImage = null;
let editingProjectName = null;
let isAdminViewing = false;
let projectHotspots = [];
let currentProjectName = null;
let currentSceneId = 'main';
let currentScene = 'main';
function getSessionId() {
    let sessionId = localStorage.getItem('ambi360_session');
    if (!sessionId) {
        sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('ambi360_session', sessionId);
    }
    return sessionId;
}

// Carregar progresso do usuário
function loadUserProgress() {
    try {
        const progress = localStorage.getItem('ambi360_progress');
        return progress ? JSON.parse(progress) : {};
    } catch (e) {
        return {};
    }
}

// Salvar progresso do usuário
function saveUserProgress(progress) {
    localStorage.setItem('ambi360_progress', JSON.stringify(progress));
}

// Desbloquear hotspot (equivale ao POST /progress/unlock)
function unlockHotspot(projectName, hotspotId) {
    const sessionId = getSessionId();
    const progress = loadUserProgress();
    
    if (!progress[sessionId]) progress[sessionId] = {};
    if (!progress[sessionId][projectName]) progress[sessionId][projectName] = [];
    
    if (!progress[sessionId][projectName].includes(hotspotId)) {
        progress[sessionId][projectName].push(hotspotId);
        saveUserProgress(progress);
    }
}

function handleSceneChange(sceneId) {
    currentScene = sceneId;
    updateNavigation();
}

function updateNavigation() {
    const navRooms = document.getElementById('navRooms');
    if (!navRooms) return;
    
    navRooms.innerHTML = '';
    
    // Cena principal
    const mainBtn = createNavButton('Cena Principal', currentScene === 'main', () => {
        if (viewer && currentScene !== 'main') {
            viewer.loadScene('main');
        }
    });
    navRooms.appendChild(mainBtn);
    
    // TODOS os hotspots com imagem (sem restrição de progressão)
    const allHotspots = projectHotspots.filter(h => h.targetImage);
    
    allHotspots.forEach(hotspot => {
        const sceneId = 'scene_' + hotspot.id;
        const isCurrentScene = currentScene === sceneId;
        
        const btn = createNavButton(
            hotspot.text, 
            isCurrentScene, 
            () => {
                if (viewer && currentScene !== sceneId) {
                    viewer.loadScene(sceneId);
                }
            }
        );
        navRooms.appendChild(btn);
    });
    
    // Aplicar filtro se houver pesquisa ativa
    const searchInput = document.getElementById('navSearch');
    if (searchInput && searchInput.value.trim()) {
        filterNavigation(searchInput.value);
    }
}

// Filtrar navegação por pesquisa
function filterNavigation(searchTerm) {
    const navRooms = document.getElementById('navRooms');
    if (!navRooms) return;
    
    const buttons = navRooms.querySelectorAll('.nav-room');
    const term = searchTerm.toLowerCase().trim();
    
    buttons.forEach(button => {
        const text = button.textContent.toLowerCase();
        if (term === '' || text.includes(term)) {
            button.style.display = 'block';
        } else {
            button.style.display = 'none';
        }
    });
}

function createNavButton(text, isActive, onClick, extraClass = '') {
    const btn = document.createElement('button');
    btn.className = `nav-room ${isActive ? 'active' : ''} ${extraClass}`;
    btn.textContent = text;
    btn.onclick = onClick;
    return btn;
}

// Carregar projetos do IndexedDB
function loadProjects() {
    if (!db) {
        console.log('⚠️ IndexedDB não disponível, usando localStorage');
        return Promise.resolve(loadProjectsFromLocalStorage());
    }
    
    return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(STORAGE_KEY);
        
        request.onsuccess = () => {
            if (request.result && request.result.projects) {
                console.log('✅ Projetos carregados do IndexedDB:', Object.keys(request.result.projects));
                resolve(request.result.projects);
            } else {
                console.log('⚠️ Nenhum projeto no IndexedDB, usando padrão');
                resolve({ ...DEFAULT_PROJECTS });
            }
        };
        
        request.onerror = () => {
            console.error('❌ Erro ao carregar do IndexedDB, usando localStorage');
            resolve(loadProjectsFromLocalStorage());
        };
    });
}

// Fallback para localStorage
function loadProjectsFromLocalStorage() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const loaded = JSON.parse(stored);
            console.log('✅ Projetos carregados do localStorage:', Object.keys(loaded));
            return loaded;
        } else {
            console.log('⚠️ Nenhum projeto salvo encontrado');
            return { ...DEFAULT_PROJECTS };
        }
    } catch (e) {
        console.error('❌ Erro ao carregar projetos:', e);
        return { ...DEFAULT_PROJECTS };
    }
}

// Carregar projetos da lixeira
function loadTrashedProjects() {
    try {
        const stored = localStorage.getItem(TRASH_KEY);
        if (stored) {
            const loaded = JSON.parse(stored);
            console.log('✅ Projetos da lixeira carregados:', Object.keys(loaded));
            return loaded;
        } else {
            console.log('⚠️ Lixeira vazia');
            return {};
        }
    } catch (e) {
        console.error('❌ Erro ao carregar lixeira:', e);
        return {};
    }
}

// Salvar projetos da lixeira
function saveTrashedProjects() {
    try {
        const data = JSON.stringify(trashedProjects);
        localStorage.setItem(TRASH_KEY, data);
        console.log('✅ Lixeira salva');
    } catch (e) {
        console.error('❌ Erro ao salvar lixeira:', e);
    }
}

// Salvar projetos no IndexedDB (sem limite de tamanho)
function saveProjects() {
    if (!db) {
        console.error('❌ IndexedDB não inicializado, usando localStorage');
        return saveProjectsToLocalStorage();
    }
    
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const data = {
        id: STORAGE_KEY,
        projects: projects,
        timestamp: Date.now()
    };
    
    const request = store.put(data);
    
    request.onsuccess = () => {
        const sizeKB = Math.round(JSON.stringify(projects).length / 1024);
        console.log(`✅ Projetos salvos no IndexedDB (${sizeKB}KB - SEM LIMITE)`);
    };
    
    request.onerror = () => {
        console.error('❌ Erro ao salvar no IndexedDB:', request.error);
        saveProjectsToLocalStorage();
    };
}

// Fallback para localStorage
function saveProjectsToLocalStorage() {
    try {
        const data = JSON.stringify(projects);
        localStorage.setItem(STORAGE_KEY, data);
        console.log('✅ Projetos salvos no localStorage (fallback)');
    } catch (e) {
        console.error('❌ Erro ao salvar no localStorage:', e.message);
        showToast('Erro ao salvar projeto.', 'danger');
    }
}



document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializePublicViewer(projectParam) {
    initDB().then(() => {
        return loadProjects();
    }).then(loadedProjects => {
        projects = loadedProjects;
        
        if (projects[projectParam]) {
            showViewer(projectParam);
        } else {
            showProjectNotFound();
        }
    }).catch(error => {
        console.error('Erro ao carregar projeto:', error);
        projects = loadProjectsFromLocalStorage();
        
        if (projects[projectParam]) {
            showViewer(projectParam);
        } else {
            showProjectNotFound();
        }
    });
}

function showProjectNotFound() {
    document.body.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); font-family: Arial, sans-serif;">
            <div style="text-align: center; color: white; max-width: 400px; padding: 40px;">
                <div style="font-size: 64px; margin-bottom: 20px;">⚠️</div>
                <h2 style="font-size: 24px; margin-bottom: 15px;">Projeto não encontrado</h2>
                <p style="font-size: 16px; margin-bottom: 30px; opacity: 0.9;">O projeto solicitado não existe ou foi removido.</p>
            </div>
        </div>
    `;
}

function initializeApp() {
    initDB().then(() => {
        return loadProjects();
    }).then(loadedProjects => {
        projects = loadedProjects;
        trashedProjects = loadTrashedProjects();
        setupEventListeners();
        loadTheme();
        
        // Restaurar estado após carregar projetos
        setTimeout(() => {
            restoreAppState();
        }, 100);
    }).catch(error => {
        console.error('Erro na inicialização:', error);
        projects = loadProjectsFromLocalStorage();
        trashedProjects = loadTrashedProjects();
        setupEventListeners();
        loadTheme();
        
        // Restaurar estado mesmo com erro
        setTimeout(() => {
            restoreAppState();
        }, 100);
    });
}

// Inicializar IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

function setupEventListeners() {
    // Login admin
    const adminForm = document.getElementById('adminForm');
    if (adminForm) {
        adminForm.addEventListener('submit', handleAdminLogin);
    }

    // Upload de arquivos
    const logoUpload = document.getElementById('logoUpload');
    if (logoUpload) {
        logoUpload.addEventListener('change', handleLogoUpload);
    }
    
    const imageUpload = document.getElementById('imageUpload');
    if (imageUpload) {
        imageUpload.addEventListener('change', handleImageUpload);
    }

    // Controles de hotspot
    const addHotspotBtn = document.getElementById('addHotspotBtn');
    if (addHotspotBtn) {
        addHotspotBtn.addEventListener('click', () => setAddHotspotMode(true));
    }
    
    const removeHotspotBtn = document.getElementById('removeHotspotBtn');
    if (removeHotspotBtn) {
        removeHotspotBtn.addEventListener('click', removeAllHotspots);
    }

    // Criar projeto
    const createProjectForm = document.getElementById('createProjectForm');
    if (createProjectForm) {
        createProjectForm.addEventListener('submit', handleCreateProject);
    }

    // Logout
    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', logout);
    }

    // Botão de logout no viewer
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
    
    // Salvar URL do site quando alterada
    const siteUrlInput = document.getElementById('siteUrl');
    if (siteUrlInput) {
        siteUrlInput.addEventListener('change', saveProjectSettings);
        siteUrlInput.addEventListener('blur', saveProjectSettings);
    }
    
    // Carregar configurações salvas
    setTimeout(loadProjectSettings, 100);
}

function handleAdminLogin(e) {
    e.preventDefault();
    
    const passwordInput = document.getElementById('adminPassword');
    if (!passwordInput) {
        return;
    }
    
    const password = passwordInput.value;
    
    // Mostrar loading
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Entrando...';
    submitBtn.disabled = true;
    
    // Simular autenticação (senha: admin123)
    setTimeout(() => {
        if (password === 'admin123') {
            hideError();
            showAdminPanel();
        } else {
            showError('Senha incorreta. Use: admin123');
        }
        
        // Restaurar botão
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }, 500);
}

function showAdminPanel() {
    document.getElementById('loginContainer').classList.add('hidden');
    document.getElementById('adminPanel').classList.remove('hidden');
    updateProjectsGrid();
    showSection('projects');
    saveAppState(); // Salvar estado
}

function updateProjectsGrid() {
    const grid = document.getElementById('projectsGrid');
    const emptyState = document.getElementById('emptyState');
    const sortOrder = document.getElementById('sortOrder')?.value || 'newest';
    
    grid.innerHTML = '';
    
    const projectEntries = Object.entries(projects);
    
    if (projectEntries.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    
    // Ordenar projetos por data
    projectEntries.sort(([,a], [,b]) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });
    
    emptyState.classList.add('hidden');
    
    projectEntries.forEach(([name, project]) => {
        const card = createProjectCard(name, project);
        grid.appendChild(card);
    });
}

function createProjectCard(name, project) {
    const createdDate = new Date(project.createdAt).toLocaleDateString('pt-BR');
    const hotspotCount = project.hotspots ? project.hotspots.length : 0;
    
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
        <div class="project-thumbnail">
            <img src="${project.image}" alt="${project.title}">
        </div>
        <div class="project-info">
            <div class="project-name">${project.title}</div>
            <div class="project-meta">Tour Virtual 360° • ${createdDate} • ${hotspotCount} pontos</div>
            <div class="project-actions">
                <button class="btn-sm btn-view" onclick="previewProject('${name}')">👁️ Ver</button>
                <button class="btn-sm btn-edit" onclick="editProject('${name}')">✏️ Editar</button>
                <button class="btn-sm btn-secondary" onclick="shareProject('${name}')">🔗 Compartilhar</button>
                <button class="btn-sm btn-delete" onclick="deleteProject('${name}')">🗑️ Excluir</button>
            </div>
        </div>
    `;
    return card;
}

// Função para compartilhar projeto diretamente do card
function shareProject(projectName) {
    const project = projects[projectName];
    if (!project) return;
    
    // Comprimir apenas imagem principal
    compressImageForShare(project.image, 300, 0.2).then(compressedMainImage => {
        const shareData = {
            t: project.title,
            i: compressedMainImage,
            l: null,
            h: []
        };
        
        const compressed = btoa(JSON.stringify(shareData));
        
        const siteUrlInput = document.getElementById('siteUrl');
        const baseUrl = siteUrlInput ? siteUrlInput.value.trim() : window.location.origin;
        const cleanBaseUrl = baseUrl.replace(/\/$/, '');
        const projectUrl = `${cleanBaseUrl}/?d=${compressed}`;
        
        copyToClipboard(projectUrl, 'Link do projeto copiado!');
    });
}

function saveProjectSettings() {
    const siteUrl = document.getElementById('siteUrl')?.value;
    if (siteUrl) {
        localStorage.setItem('ambi360_site_url', siteUrl);
    }
}

function loadProjectSettings() {
    const savedUrl = localStorage.getItem('ambi360_site_url');
    const siteUrlInput = document.getElementById('siteUrl');
    if (savedUrl && siteUrlInput) {
        siteUrlInput.value = savedUrl;
    }
}

function compressImage(file, maxWidth = 3840, quality = 0.95) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = function() {
            const ratio = Math.min(maxWidth / img.width, maxWidth / img.height);
            canvas.width = img.width * ratio;
            canvas.height = img.height * ratio;
            
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        
        img.src = URL.createObjectURL(file);
    });
}

function handleCreateProject(e) {
    e.preventDefault();
    
    const name = document.getElementById('newProjectName').value.trim();
    const title = document.getElementById('newProjectTitle').value.trim();
    const imageFile = document.getElementById('imageUpload').files[0];
    const logoFile = document.getElementById('logoUpload').files[0];

    if (!name) return showToast('Informe um nome de projeto.', 'warning');
    if (!title) return showToast('Informe um título.', 'warning');
    if (!imageFile && !editingProjectName) return showToast('Selecione uma imagem 360°.', 'warning');

    // Se é edição e não tem nova imagem
    if (editingProjectName && !imageFile) {
        console.log('Editando projeto sem nova imagem:', editingProjectName);
        const existingProject = projects[editingProjectName];
        
        // CORREÇÃO: Garantir que hotspots sejam salvos corretamente
        const hotspotsToSave = hotspots && hotspots.length > 0 ? [...hotspots] : (existingProject.hotspots || []);
        
        const projectData = {
            image: existingProject.image,
            title: title,
            hotspots: hotspotsToSave,
            createdAt: existingProject.createdAt,
            logo: existingProject.logo
        };
        
        console.log('Dados do projeto a salvar:', projectData);
        console.log('Hotspots atuais:', hotspotsToSave.length);
        console.log('Hotspots com imagem:', hotspotsToSave.filter(h => h.targetImage).length);
        
        if (logoFile) {
            compressImage(logoFile, 512, 0.9).then(compressedLogo => {
                projectData.logo = compressedLogo;
                if (editingProjectName !== name) {
                    delete projects[editingProjectName];
                }
                projects[name] = projectData;
                saveProjects();
                console.log('Projeto salvo com logo');
                showToast('Projeto atualizado!', 'success');
                editingProjectName = null;
                resetCreateForm();
                showSection('projects');
                updateProjectsGrid();
            });
        } else {
            if (editingProjectName !== name) {
                delete projects[editingProjectName];
            }
            projects[name] = projectData;
            saveProjects();
            console.log('Projeto salvo sem logo');
            showToast('Projeto atualizado!', 'success');
            editingProjectName = null;
            resetCreateForm();
            showSection('projects');
            updateProjectsGrid();
        }
        return;
    }

    showToast('Comprimindo imagem...', 'info');
    
    compressImage(imageFile).then(compressedImage => {
        // CORREÇÃO: Garantir que hotspots sejam sempre salvos
        const hotspotsToSave = hotspots && hotspots.length > 0 ? [...hotspots] : [];
        
        const projectData = {
            image: compressedImage,
            title: title,
            hotspots: hotspotsToSave,
            createdAt: editingProjectName ? projects[editingProjectName].createdAt : new Date().toISOString(),
            logo: editingProjectName ? projects[editingProjectName].logo : null
        };
        
        console.log('Salvando projeto com hotspots:', hotspotsToSave.length);
        console.log('Hotspots com imagem:', hotspotsToSave.filter(h => h.targetImage).length);
        
        if (logoFile) {
            compressImage(logoFile, 512, 0.9).then(compressedLogo => {
                projectData.logo = compressedLogo;
                if (editingProjectName && editingProjectName !== name) {
                    delete projects[editingProjectName];
                }
                projects[name] = projectData;
                saveProjects();
                showToast(editingProjectName ? 'Projeto atualizado!' : 'Projeto criado!', 'success');
                editingProjectName = null;
                resetCreateForm();
                showSection('projects');
                updateProjectsGrid();
            });
        } else {
            if (editingProjectName && editingProjectName !== name) {
                delete projects[editingProjectName];
            }
            projects[name] = projectData;
            saveProjects();
            showToast(editingProjectName ? 'Projeto atualizado!' : 'Projeto criado!', 'success');
            editingProjectName = null;
            resetCreateForm();
            showSection('projects');
            updateProjectsGrid();
        }
    });
}

function updateExistingProject(name, title, logoFile) {
    const existingProject = projects[editingProjectName];
    if (!existingProject) return;
    
    if (editingProjectName !== name) {
        delete projects[editingProjectName];
    }
    
    const projectData = {
        image: existingProject.image,
        title: title,
        hotspots: [...hotspots],
        logo: existingProject.logo || null,
        createdAt: existingProject.createdAt
    };
    
    if (logoFile) {
        const logoReader = new FileReader();
        logoReader.onload = function(e) {
            projectData.logo = e.target.result;
            saveProject(name, projectData);
        };
        logoReader.readAsDataURL(logoFile);
    } else {
        saveProject(name, projectData);
    }
}

function previewProject(name) {
    isAdminViewing = true;
    showViewer(name);
}

function showViewer(projectName) {
    const project = projects[projectName];
    currentProjectName = projectName;
    
    document.getElementById('loginContainer').classList.add('hidden');
    document.getElementById('adminPanel').classList.add('hidden');
    document.getElementById('viewerContainer').classList.remove('hidden');
    document.getElementById('projectTitle').textContent = project.title;
    document.getElementById('navProjectTitle').textContent = project.title;
    
    const projectLogo = document.getElementById('projectLogo');
    if (project.logo) {
        projectLogo.src = project.logo;
        projectLogo.style.display = 'block';
    } else {
        projectLogo.style.display = 'none';
    }
    
    projectHotspots = project.hotspots || [];
    currentSceneId = 'main';
    
    initializeViewer(project);
    saveAppState(); // Salvar estado ao entrar no viewer
}

function initializeViewer(project) {
    if (viewer) {
        viewer.destroy();
        viewer = null;
    }

    try {
        if (projectHotspots.length > 0) {
            const scenes = createScenesConfig(project.image, projectHotspots);
            viewer = pannellum.viewer('panorama', {
                default: {
                    firstScene: 'main',
                    autoLoad: true,
                    autoRotate: -2,
                    compass: true,
                    showZoomCtrl: true,
                    showFullscreenCtrl: true,
                    yaw: 0  // Sempre iniciar em 0°
                },
                scenes: scenes
            });
            
            viewer.on('scenechange', handleSceneChange);
        } else {
            viewer = pannellum.viewer('panorama', {
                type: 'equirectangular',
                panorama: project.image,
                autoLoad: true,
                autoRotate: -2,
                compass: true,
                showZoomCtrl: true,
                showFullscreenCtrl: true,
                yaw: 0  // Sempre iniciar em 0°
            });
        }
        
        viewer.on('load', updateNavigation);
        
    } catch (e) {
        console.error('Erro ao iniciar viewer:', e);
        showToast('Não foi possível carregar o panorama.', 'danger');
    }
}

function createScenesConfig(mainImage, hotspotsArray) {
    const scenes = { 
        main: { 
            type: 'equirectangular', 
            panorama: mainImage, 
            hotSpots: [],
            yaw: 0  // Cena principal sempre inicia em 0°
        } 
    };
    
    // CORREÇÃO: Filtrar APENAS pontos ROOT (parentId = null) para cena principal
    const rootHotspots = (hotspotsArray || []).filter(h => h.parentId === null || h.parentId === undefined);
    
    // Na cena principal, mostrar apenas pontos ROOT
    rootHotspots.forEach(hotspot => {
        if (hotspot.targetImage) {
            scenes.main.hotSpots.push({
                id: hotspot.id,
                pitch: hotspot.pitch,
                yaw: hotspot.yaw,
                type: 'scene',
                text: hotspot.text,
                sceneId: 'scene_' + hotspot.id,
                cssClass: getHotspotClass(hotspot.type, hotspot.typeImage)
            });
        }
    });
    
    // Criar cenas para TODOS os hotspots (não apenas ROOT)
    const allHotspots = (hotspotsArray || []);
    allHotspots.forEach((hotspot) => {
        if (hotspot.targetImage) {
            const sceneId = 'scene_' + hotspot.id;
            const hotSpots = [];
            
            // Botão voltar sempre a 180° do ponto de vista inicial (0°)
            const parentScene = hotspot.parentId ? 'scene_' + hotspot.parentId : 'main';
            
            hotSpots.push({
                id: `back_${sceneId}`,
                pitch: -10,
                yaw: 180,  // Sempre a 180° do ponto de vista inicial
                type: 'scene',
                text: 'Voltar',
                sceneId: parentScene,
                cssClass: 'hotspot-back'
            });
            
            // CORREÇÃO: Mostrar APENAS filhos diretos deste hotspot
            const childHotspots = allHotspots.filter(child => child.parentId === hotspot.id);
            childHotspots.forEach(child => {
                if (child.targetImage) {
                    hotSpots.push({
                        id: child.id,
                        pitch: child.pitch,
                        yaw: child.yaw,
                        type: 'scene',
                        text: child.text,
                        sceneId: 'scene_' + child.id,
                        cssClass: getHotspotClass(child.type, child.typeImage)
                    });
                }
            });
            
            scenes[sceneId] = {
                type: 'equirectangular',
                panorama: hotspot.targetImage,
                hotSpots: hotSpots
                // CORREÇÃO: Remover yaw fixo - deixar Pannellum decidir baseado na navegação
            };
        }
    });
    
    return scenes;
}

function getHotspotClass(type, typeImage) {
    if (type === 'door') {
        return typeImage === 'porta 2.png' ? 'hotspot-door porta-2' : 'hotspot-door porta-1';
    } else {
        return typeImage === 'normal 2.png' ? 'hotspot-nav normal-2' : 'hotspot-nav normal-1';
    }
}

function createNavigation() {
    const navRooms = document.getElementById('navRooms');
    if (!navRooms) return;
    
    navRooms.innerHTML = '';
    const project = projects[currentProjectName];
    const sessionId = getSessionId();
    const progress = loadUserProgress();
    const unlockedHotspots = progress[sessionId]?.[currentProjectName] || [];
    
    // Ambiente principal (sempre desbloqueado)
    const mainBtn = document.createElement('button');
    mainBtn.className = 'nav-room active';
    mainBtn.textContent = 'Ambiente Principal';
    mainBtn.onclick = () => navigateToScene(project.image, 'Ambiente Principal');
    navRooms.appendChild(mainBtn);
    
    // Ambientes dos hotspots
    if (project.hotspots) {
        project.hotspots.forEach((hotspot, index) => {
            if (hotspot.targetImage) {
                const isUnlocked = unlockedHotspots.includes(hotspot.id);
                const btn = document.createElement('button');
                btn.className = `nav-room ${isUnlocked ? '' : 'locked'}`;
                btn.textContent = isUnlocked ? hotspot.text : '🔒 Bloqueado';
                
                if (isUnlocked) {
                    btn.onclick = () => navigateToScene(hotspot.targetImage, hotspot.text);
                } else {
                    btn.onclick = () => showToast('Ambiente bloqueado. Explore outros pontos primeiro.', 'warning');
                }
                
                navRooms.appendChild(btn);
            }
        });
    }
}

function navigateToScene(imageUrl, sceneName) {
    // Encontrar hotspot que tem essa imagem como target
    const project = projects[currentProjectName];
    const hotspot = project.hotspots.find(h => h.targetImage === imageUrl);
    
    if (hotspot) {
        sceneHistory.push(currentSceneId);
        loadScene(hotspot.id, imageUrl);
    } else {
        loadScene('main', project.image);
    }
    
    // Atualizar navegação ativa
    document.querySelectorAll('.nav-room').forEach(btn => btn.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
}

// Voltar para cena anterior
function goBackToPreviousScene() {
    if (sceneHistory.length > 0) {
        const previousSceneId = sceneHistory.pop();
        
        if (previousSceneId === 'main') {
            const project = projects[currentProjectName];
            loadScene('main', project.image);
        } else {
            // Encontrar hotspot pelo ID para pegar a imagem
            const project = projects[currentProjectName];
            const hotspot = project.hotspots.find(h => h.id === previousSceneId);
            if (hotspot && hotspot.targetImage) {
                loadScene(previousSceneId, hotspot.targetImage);
            } else {
                loadScene('main', project.image);
            }
        }
        
        createNavigation();
        showToast('Voltou para cena anterior', 'info');
    }
}

function editProject(name) {
    const project = projects[name];
    if (!project) return;
    
    editingProjectName = name;
    
    document.getElementById('newProjectName').value = name;
    document.getElementById('newProjectTitle').value = project.title;
    
    if (project.logo) {
        showExistingLogo(project.logo);
    }
    
    if (project.image) {
        showImagePreview(project.image);
        hotspots = project.hotspots ? [...project.hotspots] : [];
        setTimeout(() => updateHotspotsList(), 500);
    }
    
    document.getElementById('pageTitle').textContent = 'Editar Projeto';
    document.getElementById('pageSubtitle').textContent = 'Modifique as configurações do projeto.';
    document.getElementById('submitProjectBtn').textContent = 'Salvar Alterações';
    
    showSection('create');
}

function deleteProject(name) {
    if (confirm(`Mover projeto "${projects[name].title}" para a lixeira?`)) {
        // Mover para lixeira
        trashedProjects[name] = {
            ...projects[name],
            deletedAt: new Date().toISOString()
        };
        
        delete projects[name];
        saveProjects();
        saveTrashedProjects();
        updateProjectsGrid();
        showToast('Projeto movido para a lixeira.', 'success');
    }
}

// Atualizar grid da lixeira
function updateTrashGrid() {
    const grid = document.getElementById('trashGrid');
    const emptyState = document.getElementById('emptyTrash');
    grid.innerHTML = '';
    
    const trashEntries = Object.entries(trashedProjects);
    
    if (trashEntries.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    
    emptyState.classList.add('hidden');
    
    trashEntries.forEach(([name, project]) => {
        const card = createTrashCard(name, project);
        grid.appendChild(card);
    });
}

// Criar card da lixeira
function createTrashCard(name, project) {
    const deletedDate = new Date(project.deletedAt).toLocaleDateString('pt-BR');
    const hotspotCount = project.hotspots ? project.hotspots.length : 0;
    
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
        <div class="project-thumbnail">
            <img src="${project.image}" alt="${project.title}">
            <div style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.7); color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                🗑️ Excluído
            </div>
        </div>
        <div class="project-info">
            <div class="project-name">${project.title}</div>
            <div class="project-meta">Excluído em ${deletedDate} • ${hotspotCount} pontos</div>
            <div class="project-actions">
                <button class="btn-sm btn-view" onclick="restoreProject('${name}')">↩️ Restaurar</button>
                <button class="btn-sm btn-delete" onclick="permanentlyDeleteProject('${name}')">🗑️ Apagar Permanentemente</button>
            </div>
        </div>
    `;
    return card;
}

// Restaurar projeto da lixeira
function restoreProject(name) {
    if (confirm(`Restaurar projeto "${trashedProjects[name].title}"?`)) {
        const project = { ...trashedProjects[name] };
        delete project.deletedAt;
        
        projects[name] = project;
        delete trashedProjects[name];
        
        saveProjects();
        saveTrashedProjects();
        updateTrashGrid();
        showToast('Projeto restaurado!', 'success');
    }
}

// Apagar projeto permanentemente
function permanentlyDeleteProject(name) {
    if (confirm(`ATENÇÃO: Apagar permanentemente "${trashedProjects[name].title}"?\n\nEsta ação NÃO pode ser desfeita!`)) {
        delete trashedProjects[name];
        saveTrashedProjects();
        updateTrashGrid();
        showToast('Projeto apagado permanentemente.', 'success');
    }
}

function showSection(section) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    document.getElementById('projectsSection').classList.add('hidden');
    document.getElementById('createSection').classList.add('hidden');
    document.getElementById('trashSection').classList.add('hidden');
    
    if (section === 'projects') {
        document.getElementById('projectsSection').classList.remove('hidden');
        document.getElementById('pageTitle').textContent = 'Projetos';
        document.getElementById('pageSubtitle').textContent = 'Aqui você faz a gestão de seus projetos.';
        document.querySelectorAll('.nav-item')[0].classList.add('active');
        resetCreateForm();
    } else if (section === 'create') {
        document.getElementById('createSection').classList.remove('hidden');
        updateCreateSectionTitle();
        document.querySelectorAll('.nav-item')[1].classList.add('active');
    } else if (section === 'trash') {
        document.getElementById('trashSection').classList.remove('hidden');
        document.getElementById('pageTitle').textContent = 'Lixeira';
        document.getElementById('pageSubtitle').textContent = 'Projetos excluídos podem ser restaurados ou apagados permanentemente.';
        document.querySelectorAll('.nav-item')[2].classList.add('active');
        updateTrashGrid();
    }
    
    saveAppState(); // Salvar estado ao mudar seção
}

function updateCreateSectionTitle() {
    if (!editingProjectName) {
        document.getElementById('pageTitle').textContent = 'Criar Projeto';
        document.getElementById('pageSubtitle').textContent = 'Configure um novo projeto 360°.';
        document.getElementById('submitProjectBtn').textContent = 'Criar Projeto';
    }
}

function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById('logoPreview');
        const uploadText = document.getElementById('logoUploadText');
        
        preview.innerHTML = `
            <img src="${e.target.result}" alt="Logo preview">
            <div style="margin-top: 8px; font-size: 12px; color: #6b7280;">Logo selecionada: ${file.name}</div>
            <button type="button" class="btn-danger" style="margin-top: 8px; padding: 4px 8px; font-size: 12px;" onclick="removeLogo()">Remover Logo</button>
        `;
        preview.classList.remove('hidden');
        uploadText.innerHTML = '✅ Logo selecionada';
    };
    reader.readAsDataURL(file);
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            showImagePreview(e.target.result);
        };
        reader.readAsDataURL(file);
    } else {
        hideImagePreview();
    }
}

function showImagePreview(imageSrc) {
    document.getElementById('imagePreview').classList.remove('hidden');
    // INICIALIZAR: currentParentId = null significa ROOT (ponto principal inicial)
    currentParentId = null;
    previewCurrentImage = imageSrc;
    previewRootImage = imageSrc;

    if (previewViewer) {
        previewViewer.destroy();
    }

    setTimeout(() => {
        previewViewer = pannellum.viewer('previewPanorama', {
            type: 'equirectangular',
            panorama: previewCurrentImage,
            autoLoad: true,
            showZoomCtrl: false,
            showFullscreenCtrl: false
        });
        
        previewViewer.on('load', function() {
            setupHotspotClick();
            updateHotspotsList();
        });
    }, 100);
}

function hideImagePreview() {
    document.getElementById('imagePreview').classList.add('hidden');
    if (previewViewer) {
        previewViewer.destroy();
        previewViewer = null;
    }
    hotspots = [];
    addingHotspot = false;
}

function setupHotspotClick() {
    const panoramaDiv = document.getElementById('previewPanorama');
    if (!panoramaDiv) return;
    
    const onClickPreview = (event) => {
        if (!addingHotspot) return;
        event.preventDefault();
        event.stopPropagation();
        
        let coords = null;
        try { 
            coords = previewViewer.mouseEventToCoords(event); 
        } catch (_) {}
        
        const pitch = coords ? coords[0] : previewViewer.getPitch();
        const yaw = coords ? coords[1] : previewViewer.getYaw();
        
        addHotspot(pitch, yaw);
    };
    
    panoramaDiv.addEventListener('click', onClickPreview, true);
}

function addHotspot(pitch, yaw) {
    const hotspot = {
        id: 'hotspot_' + Date.now(),
        pitch: pitch,
        yaw: yaw,
        text: 'Ponto ' + (hotspots.length + 1),
        targetImage: '',
        parentId: currentParentId, // Sistema hierárquico como no protótipo
        type: 'normal',
        typeImage: 'normal 1.png',
        unlock_order: hotspots.length
    };
    
    hotspots.push(hotspot);
    addHotspotToViewer(hotspot);
    updateHotspotsList();
    setAddHotspotMode(false);
    showToast('Ponto adicionado!', 'success');
}

function addHotspotToViewer(hotspot) {
    if (previewViewer) {
        const hotspotConfig = {
            id: hotspot.id,
            pitch: hotspot.pitch,
            yaw: hotspot.yaw,
            type: 'info',
            text: hotspot.text,
            cssClass: 'hotspot-nav'
        };
        
        previewViewer.addHotSpot(hotspotConfig);
    }
}

function updateHotspotsList() {
    const list = document.getElementById('hotspotsList');
    if (!list) return;
    
    list.innerHTML = '';

    const currentList = hotspots.filter(h => (h.parentId || null) === (currentParentId || null));

    if (currentParentId) {
        const backBtn = document.createElement('button');
        backBtn.textContent = '↩ Voltar';
        backBtn.className = 'btn-secondary';
        backBtn.style.marginBottom = '8px';
        backBtn.onclick = goBackToParent;
        list.appendChild(backBtn);
    }

    if (currentList.length === 0) {
        const p = document.createElement('p');
        p.style.color = '#6b7280';
        p.style.fontStyle = 'italic';
        p.textContent = 'Nenhum ponto adicionado nesta cena';
        list.appendChild(p);
        return;
    }

    currentList.forEach((hotspot, index) => {
        const item = createHotspotItem(hotspot, index);
        list.appendChild(item);
    });
}

function createHotspotItem(hotspot, index) {
    const item = document.createElement('div');
    item.className = 'hotspot-item';
    
    const hotspotType = hotspot.type || 'normal';
    
    item.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 8px;">Ponto ${index + 1}</div>
        <input type="text" class="hotspot-input" placeholder="Nome do ponto" value="${hotspot.text}" onchange="updateHotspotText('${hotspot.id}', this.value)">
        
        <div style="margin-bottom: 12px;">
            <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">Tipo do Ponto:</div>
            <div style="display: flex; gap: 8px;">
                <button type="button" class="btn-secondary ${hotspotType === 'normal' ? 'btn-primary' : ''}" onclick="changeHotspotType('${hotspot.id}', 'normal')" style="flex: 1; padding: 8px;">Normal</button>
                <button type="button" class="btn-secondary ${hotspotType === 'door' ? 'btn-primary' : ''}" onclick="changeHotspotType('${hotspot.id}', 'door')" style="flex: 1; padding: 8px;">Porta</button>
            </div>
        </div>
        
        <div style="margin-bottom: 12px;">
            <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">Ajustar Posição:</div>
            <div class="hotspot-grid">
                <div></div>
                <button class="hotspot-btn" onclick="moveHotspot('${hotspot.id}', 0, 5)">↑</button>
                <div></div>
                <button class="hotspot-btn" onclick="moveHotspot('${hotspot.id}', -5, 0)">←</button>
                <button class="hotspot-btn center" onclick="centerHotspot('${hotspot.id}')">Centro</button>
                <button class="hotspot-btn" onclick="moveHotspot('${hotspot.id}', 5, 0)">→</button>
                <div></div>
                <button class="hotspot-btn" onclick="moveHotspot('${hotspot.id}', 0, -5)">↓</button>
                <div></div>
            </div>
            <div style="font-size: 11px; color: #6b7280; margin-top: 6px; text-align: center;">Pitch: ${hotspot.pitch.toFixed(1)}° | Yaw: ${hotspot.yaw.toFixed(1)}°</div>
        </div>
        
        <input type="file" accept="image/*" onchange="updateHotspotImage('${hotspot.id}', this)" style="width: 100%; margin-bottom: 8px;">
        <small style="color: #6b7280; display: block; margin-bottom: 8px;">Selecione a imagem 360° para este ponto</small>
        
        <button class="${hotspot.targetImage ? 'btn-primary' : 'btn-secondary'}" onclick="${hotspot.targetImage ? `enterHotspot('${hotspot.id}')` : `testHotspot('${hotspot.id}')`}" style="width: 100%; margin-bottom: 8px;">
            ${hotspot.targetImage ? '🔍 Entrar no Ponto' : 'Testar Posição'}
        </button>
        
        <button class="btn-danger" onclick="removeHotspot('${hotspot.id}')" style="width: 100%;">Remover</button>
    `;
    
    return item;
}

function updateHotspotText(id, text) {
    const hotspot = hotspots.find(h => h.id === id);
    if (hotspot) {
        hotspot.text = text;
        if (previewViewer) {
            previewViewer.removeHotSpot(id);
            addHotspotToViewer(hotspot);
        }
    }
}

function updateHotspotImage(id, input) {
    const file = input.files[0];
    if (file) {
        // Manter qualidade alta - IndexedDB não tem limite
        compressImage(file, 3840, 0.95).then(compressedImage => {
            const hotspot = hotspots.find(h => h.id === id);
            if (hotspot) {
                hotspot.targetImage = compressedImage;
                updateHotspotsList();
                showToast('Imagem adicionada ao ponto!', 'success');
            }
        });
    }
}

function changeHotspotType(id, type) {
    const hotspot = hotspots.find(h => h.id === id);
    if (hotspot) {
        hotspot.type = type;
        
        if (type === 'door') {
            hotspot.typeImage = hotspot.typeImage === 'porta 1.png' ? 'porta 2.png' : 'porta 1.png';
        } else {
            hotspot.typeImage = hotspot.typeImage === 'normal 1.png' ? 'normal 2.png' : 'normal 1.png';
        }
        
        if (previewViewer) {
            previewViewer.removeHotSpot(id);
            addHotspotToViewer(hotspot);
        }
        
        updateHotspotsList();
        const imageName = hotspot.typeImage.replace('.png', '').replace(' ', ' ');
        showToast(`Tipo alterado para ${type === 'door' ? 'Porta' : 'Normal'} (${imageName})!`, 'success');
    }
}

function moveHotspot(id, deltaYaw, deltaPitch) {
    const hotspot = hotspots.find(h => h.id === id);
    if (hotspot && previewViewer) {
        hotspot.yaw = ((hotspot.yaw + deltaYaw) % 360 + 360) % 360;
        hotspot.pitch = Math.max(-90, Math.min(90, hotspot.pitch + deltaPitch));
        previewViewer.removeHotSpot(id);
        addHotspotToViewer(hotspot);
        updateHotspotsList();
    }
}

function centerHotspot(id) {
    const hotspot = hotspots.find(h => h.id === id);
    if (hotspot && previewViewer) {
        hotspot.pitch = previewViewer.getPitch();
        hotspot.yaw = previewViewer.getYaw();
        previewViewer.removeHotSpot(id);
        addHotspotToViewer(hotspot);
        updateHotspotsList();
    }
}

function testHotspot(id) {
    const hotspot = hotspots.find(h => h.id === id);
    if (hotspot && previewViewer) {
        previewViewer.lookAt(hotspot.pitch, hotspot.yaw, 75, 1000);
    }
}



function goBackToParent() {
    const parentHotspot = hotspots.find(h => h.id === currentParentId);
    const grandParentId = parentHotspot ? (parentHotspot.parentId || null) : null;
    currentParentId = grandParentId;
    
    if (grandParentId) {
        const gpHotspot = hotspots.find(h => h.id === grandParentId);
        if (gpHotspot && gpHotspot.targetImage) {
            previewCurrentImage = gpHotspot.targetImage;
            showImagePreview(previewCurrentImage);
        }
    } else {
        previewCurrentImage = previewRootImage;
        showImagePreview(previewCurrentImage);
    }
    updateHotspotsList();
}

function enterHotspot(id) {
    const hotspot = hotspots.find(h => h.id === id);
    if (hotspot && hotspot.targetImage && previewViewer) {
        // MUDAR PONTO PRINCIPAL ATIVO: currentParentId = hotspot.id
        currentParentId = hotspot.id;
        previewCurrentImage = hotspot.targetImage;
        showImagePreview(previewCurrentImage);
        // Após showImagePreview, restaurar o currentParentId correto
        currentParentId = hotspot.id;
        updateHotspotsList();
    }
}

function removeHotspot(id) {
    hotspots = hotspots.filter(h => h.id !== id);
    if (previewViewer) {
        previewViewer.removeHotSpot(id);
    }
    updateHotspotsList();
}

function removeAllHotspots() {
    hotspots = [];
    updateHotspotsList();
    if (previewViewer) {
        previewViewer.removeAllHotSpots();
    }
}

function setAddHotspotMode(on) {
    const btn = document.getElementById('addHotspotBtn');
    addingHotspot = !!on;
    if (btn) {
        if (on) {
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
            btn.textContent = 'Clique na imagem';
        } else {
            btn.classList.add('btn-secondary');
            btn.classList.remove('btn-primary');
            btn.textContent = 'Adicionar Ponto';
        }
    }
}

function showExistingLogo(logoSrc) {
    const preview = document.getElementById('logoPreview');
    const uploadText = document.getElementById('logoUploadText');
    
    preview.innerHTML = `
        <img src="${logoSrc}" alt="Logo preview">
        <div style="margin-top: 8px; font-size: 12px; color: #6b7280;">Logo atual do projeto</div>
        <button type="button" class="btn-danger" style="margin-top: 8px; padding: 4px 8px; font-size: 12px;" onclick="removeLogo()">Remover Logo</button>
    `;
    preview.classList.remove('hidden');
    uploadText.innerHTML = '✅ Logo carregada';
}

function removeLogo() {
    document.getElementById('logoUpload').value = '';
    document.getElementById('logoPreview').classList.add('hidden');
    document.getElementById('logoUploadText').innerHTML = '🖼️ Clique para selecionar uma logo';
}

function resetCreateForm() {
    editingProjectName = null;
    document.getElementById('createProjectForm').reset();
    hideImagePreview();
    removeLogo();
    hotspots = [];
    updateCreateSectionTitle();
}

function slugify(str) {
    return (str || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
    }
}

function hideError() {
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
    }
}

function showToast(message, type = 'success') {
    const errorDiv = document.getElementById('errorMessage');
    if (!errorDiv) return alert(message);
    
    errorDiv.textContent = message;
    errorDiv.className = `error ${type}`;
    errorDiv.classList.remove('hidden');
    
    setTimeout(() => {
        errorDiv.classList.add('hidden');
        errorDiv.className = 'error';
    }, 3000);
}



function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

function showHelpModal() {
    document.getElementById('helpModal').classList.remove('hidden');
}

function closeHelpModal() {
    document.getElementById('helpModal').classList.add('hidden');
}

// Funcionalidades de Compartilhamento
function showShareModal() {
    if (!currentProjectName) return;
    
    const project = projects[currentProjectName];
    if (!project) return;
    
    const modal = document.getElementById('shareModal');
    const shareUrl = document.getElementById('shareUrl');
    const embedCode = document.getElementById('embedCode');
    
    // Comprimir apenas imagem principal - sem hotspots com imagens
    compressImageForShare(project.image, 300, 0.2).then(compressedMainImage => {
        const shareData = {
            t: project.title,
            i: compressedMainImage,
            l: project.logo ? null : null, // Remover logo para reduzir tamanho
            h: [] // Sem hotspots com imagens para compartilhamento
        };
        
        const compressed = btoa(JSON.stringify(shareData));
        
        const siteUrlInput = document.getElementById('siteUrl');
        const baseUrl = siteUrlInput ? siteUrlInput.value.trim() : window.location.origin;
        const cleanBaseUrl = baseUrl.replace(/\/$/, '');
        
        // Usar index.html da raiz
        const projectUrl = `${cleanBaseUrl}/?d=${compressed}`;
        
        shareUrl.value = projectUrl;
        embedCode.value = `<iframe src="${projectUrl}" width="800" height="600" frameborder="0" allowfullscreen></iframe>`;
        
        modal.classList.remove('hidden');
    });
}

function compressImageForShare(dataUrl, maxWidth, quality = 0.2) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = function() {
            const ratio = Math.min(maxWidth / img.width, maxWidth / img.height);
            canvas.width = img.width * ratio;
            canvas.height = img.height * ratio;
            
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        
        img.src = dataUrl;
    });
}

function closeShareModal() {
    document.getElementById('shareModal').classList.add('hidden');
}

function copyShareUrl() {
    const shareUrl = document.getElementById('shareUrl');
    copyToClipboard(shareUrl.value, 'Link copiado com sucesso!');
}

function copyEmbedCode() {
    const embedCode = document.getElementById('embedCode');
    copyToClipboard(embedCode.value, 'Código copiado com sucesso!');
}

function copyToClipboard(text, successMessage) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showShareToast(successMessage);
        }).catch(() => {
            fallbackCopyToClipboard(text, successMessage);
        });
    } else {
        fallbackCopyToClipboard(text, successMessage);
    }
}

function fallbackCopyToClipboard(text, successMessage) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        showShareToast(successMessage);
    } catch (err) {
        console.error('Erro ao copiar:', err);
        prompt('Copie o texto abaixo:', text);
    }
    
    textArea.remove();
}

function showShareToast(message) {
    const toast = document.getElementById('shareToast');
    const messageElement = toast.querySelector('.toast-message');
    
    messageElement.textContent = message;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

function shareOnWhatsApp() {
    const shareUrl = document.getElementById('shareUrl').value;
    const text = encodeURIComponent(`Confira este tour virtual 360°: ${shareUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
}

function shareOnFacebook() {
    const shareUrl = document.getElementById('shareUrl').value;
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank');
}

function shareOnTwitter() {
    const shareUrl = document.getElementById('shareUrl').value;
    const text = encodeURIComponent(`Confira este tour virtual 360°`);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(shareUrl)}`, '_blank');
}

function shareByEmail() {
    const shareUrl = document.getElementById('shareUrl').value;
    const subject = encodeURIComponent('Tour Virtual 360°');
    const body = encodeURIComponent(`Olá!\n\nGostaria de compartilhar este tour virtual 360° com você:\n\n${shareUrl}\n\nAproveite a experiência!`);
    window.open(`mailto:?subject=${subject}&body=${body}`);
}



function toggleNavigation() {
    if (isAdminViewing) {
        if (viewer) {
            viewer.destroy();
            viewer = null;
        }
        document.getElementById('viewerContainer').classList.add('hidden');
        document.getElementById('adminPanel').classList.remove('hidden');
        isAdminViewing = false;
    } else {
        logout();
    }
}

function logout() {
    if (viewer) {
        viewer.destroy();
        viewer = null;
    }
    
    if (previewViewer) {
        previewViewer.destroy();
        previewViewer = null;
    }
    
    // Resetar histórico de navegação
    sceneHistory = [];
    
    document.getElementById('viewerContainer').classList.add('hidden');
    document.getElementById('adminPanel').classList.add('hidden');
    document.getElementById('loginContainer').classList.remove('hidden');
    document.getElementById('adminForm').reset();
    hideError();
    resetCreateForm();
    isAdminViewing = false;
    
    // Limpar estado salvo
    localStorage.removeItem(STATE_KEY);
}

function toggleDarkMode() {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    
    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        btn.textContent = isDark ? 'Modo Claro' : 'Modo Escuro';
    }
}

function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark');
    }
    
    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        const isDark = document.body.classList.contains('dark');
        btn.textContent = isDark ? 'Modo Claro' : 'Modo Escuro';
    }
}