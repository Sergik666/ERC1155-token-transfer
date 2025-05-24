let currentLanguage = 'en';
let translations = {};
let isLoading = false;

const languages = {
    'en': 'English',
    'ru': 'Русский', 
};

async function loadTranslations(lang) {
    if (isLoading) return;
    
    if (lang === 'en') {
        translations[lang] = {};
        return;
    }
    
    if (translations[lang]) {
        return;
    }
    
    isLoading = true;
    document.body.classList.add('loading');
    
    try {
        const response = await fetch(`translations/${lang}.json`);
        if (response.ok) {
            translations[lang] = await response.json();
        } else {
            console.warn(`Failed to load translations for language: ${lang}`);
            translations[lang] = {};
        }
    } catch (error) {
        console.error(`Error loading translations for ${lang}:`, error);
        translations[lang] = {};
    } finally {
        isLoading = false;
        document.body.classList.remove('loading');
    }
}

async function changeLanguage(lang) {
    if (isLoading || currentLanguage === lang) return;
    
    currentLanguage = lang;
    
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    await loadTranslations(lang);
    
    applyTranslations();
    
    localStorage.setItem('selectedLanguage', lang);
    
    document.documentElement.lang = lang;
}

function applyTranslations() {
    const elements = document.querySelectorAll('[data-translate]');
    
    elements.forEach(element => {
        const key = element.getAttribute('data-translate');
        const translation = getTranslation(key);
        element.textContent = translation;
    });
}

function getTranslation(key) {
    if (currentLanguage === 'en') {
        return key;
    }
    
    return translations[currentLanguage] && translations[currentLanguage][key] 
        ? translations[currentLanguage][key] 
        : key;
}

function t(key) {
    return getTranslation(key);
}


function setActiveLanguageButton(lang) {
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.remove('active');
        const btnText = btn.textContent.trim();
        if ((lang === 'en' && btnText === 'English') ||
            (lang === 'ru' && btnText === 'Русский')) {
            btn.classList.add('active');
        }
    });
}

document.addEventListener('DOMContentLoaded', async function() {
    const savedLanguage = localStorage.getItem('selectedLanguage');
    if (savedLanguage && languages[savedLanguage]) {
        currentLanguage = savedLanguage;
        setActiveLanguageButton(savedLanguage);
        document.documentElement.lang = savedLanguage;
    }
    
    await loadTranslations(currentLanguage);
    
    applyTranslations();
});

window.changeLanguage = changeLanguage;
window.t = t;
