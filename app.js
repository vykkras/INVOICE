// Initialize date to today
const defaultDate = new Date().toISOString().split('T')[0];

let invoiceData = {
    invoiceNumber: '0454',
    date: defaultDate,
    project: '',
    supervisor: '',
    from: '',
    billTo: '',
    billToAddress: '',
    notes: '',
    items: [],
    metaFields: []
};

// Load saved invoices from localStorage
let savedInvoices = JSON.parse(localStorage.getItem('invoices') || '[]');
let savedFolders = JSON.parse(localStorage.getItem('invoiceFolders') || '[]');
let currentFolderId = null;
let currentSavedFolderId = null;
let lastOpenedFolderId = null;
let suppressClick = false;
let dragState = null;
let deleteHistory = JSON.parse(localStorage.getItem('invoiceDeleteHistory') || '[]');
let currentInvoiceNumber = null;
let moveDialogInvoiceNumber = null;
let moveDialogFolderId = null;
let supabaseClient = null;
let supabaseSyncTimer = null;
let remoteStateLoaded = false;
let allowSupabaseSync = false;
let pendingDuplicate = null;
let savedTemplates = JSON.parse(localStorage.getItem('invoiceTemplates') || '[]');
let currentTemplateId = null;
let _newInvoiceContext = 'home';

const SUPABASE_URL = 'https://rqnmaoqzdwnuaiwrutte.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxbm1hb3F6ZHdudWFpd3J1dHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5ODE1MzAsImV4cCI6MjA4NDU1NzUzMH0.ZE77nGj5-4zCSDwmAh5exlnQ_NcVxGniDVua_qLA0Fs';
const WORKSPACE_ID = 'default';

function saveFolders() {
    try {
        localStorage.setItem('invoiceFolders', JSON.stringify(savedFolders));
    } catch (e) {
        console.error('Failed to save folders to localStorage:', e);
        alert('Warning: Could not save folders. Storage may be full.');
    }
    scheduleSupabaseSync();
}

function saveInvoices() {
    try {
        localStorage.setItem('invoices', JSON.stringify(savedInvoices));
    } catch (e) {
        console.error('Failed to save invoices to localStorage:', e);
        alert('Warning: Could not save invoices. Storage may be full.');
    }
    scheduleSupabaseSync();
}

function saveDeleteHistory() {
    try {
        localStorage.setItem('invoiceDeleteHistory', JSON.stringify(deleteHistory));
    } catch (e) {
        console.error('Failed to save delete history to localStorage:', e);
    }
    scheduleSupabaseSync();
}
// ── Templates ────────────────────────────────────────────────────────────────

function saveTemplatesLocally() {
    try {
        localStorage.setItem('invoiceTemplates', JSON.stringify(savedTemplates));
    } catch (e) {
        console.error('Failed to save templates:', e);
        alert('Warning: Could not save templates. Storage may be full.');
    }
}

function updateTemplateSaveBtn() {
    const btn = document.getElementById('saveTemplateBtn');
    if (!btn) return;
    btn.textContent = currentTemplateId ? 'Update Template' : 'Save as Template';
}

function saveAsTemplate() {
    let name;
    if (currentTemplateId) {
        const existing = savedTemplates.find(t => t.id === currentTemplateId);
        name = existing ? existing.name : 'Template';
    } else {
        name = prompt('Template name:');
        if (!name || !name.trim()) return;
        name = name.trim();
    }
    const data = collectInvoiceData();
    const id = currentTemplateId || ('template-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const template = { id, name, from: data.from, billTo: data.billTo, billToAddress: data.billToAddress, notes: data.notes, items: data.items, metaFields: data.metaFields, project: data.project, supervisor: data.supervisor };
    const idx = savedTemplates.findIndex(t => t.id === id);
    if (idx >= 0) {
        savedTemplates[idx] = template;
    } else {
        savedTemplates.push(template);
        currentTemplateId = id;
    }
    saveTemplatesLocally();
    syncTemplateToSupabase(template);
    updateTemplateSaveBtn();
    renderSavedView();
    alert(currentTemplateId === id && idx >= 0 ? 'Template updated!' : 'Template saved!');
}

function editTemplate(templateId) {
    const template = savedTemplates.find(t => t.id === templateId);
    if (!template) return;
    currentTemplateId = templateId;
    currentInvoiceNumber = null;
    const invoiceLike = {
        invoiceNumber: '',
        date: '',
        project: template.project || '',
        supervisor: template.supervisor || '',
        from: template.from || '',
        billTo: template.billTo || '',
        billToAddress: template.billToAddress || '',
        notes: template.notes || '',
        items: Array.isArray(template.items) ? template.items.map(i => ({ ...i })) : [],
        metaFields: Array.isArray(template.metaFields) ? template.metaFields.map(f => ({ ...f })) : [],
        folderId: null
    };
    loadInvoice(invoiceLike);
    updateTemplateSaveBtn();
    showEditor();
}

function newInvoiceFromTemplate(templateId) {
    const template = savedTemplates.find(t => t.id === templateId);
    if (!template) return;
    closeNewInvoiceDropdown();
    currentTemplateId = null;
    currentFolderId = currentFolderId || ensureDefaultFolder();
    const newNumber = getNextInvoiceNumber();
    currentInvoiceNumber = newNumber;
    const invoiceLike = {
        invoiceNumber: newNumber,
        date: new Date().toISOString().split('T')[0],
        project: template.project || '',
        supervisor: template.supervisor || '',
        from: template.from || '',
        billTo: template.billTo || '',
        billToAddress: template.billToAddress || '',
        notes: template.notes || '',
        items: Array.isArray(template.items) ? JSON.parse(JSON.stringify(template.items)) : [],
        metaFields: Array.isArray(template.metaFields) ? template.metaFields.map(f => ({ ...f })) : [],
        folderId: currentFolderId
    };
    loadInvoice(invoiceLike);
    updateTemplateSaveBtn();
    showEditor();
}

function renameTemplate(templateId) {
    const template = savedTemplates.find(t => t.id === templateId);
    if (!template) return;
    const name = prompt('Template name:', template.name);
    if (!name || !name.trim()) return;
    template.name = name.trim();
    saveTemplatesLocally();
    syncTemplateToSupabase(template);
    renderSavedView();
}

function deleteTemplate(templateId) {
    if (!confirm('Delete this template?')) return;
    savedTemplates = savedTemplates.filter(t => t.id !== templateId);
    if (currentTemplateId === templateId) {
        currentTemplateId = null;
        updateTemplateSaveBtn();
    }
    saveTemplatesLocally();
    deleteTemplateFromSupabase(templateId);
    renderSavedView();
}

// ── New invoice dropdown ──────────────────────────────────────────────────────

function showNewInvoiceDropdown(btn, context) {
    _newInvoiceContext = context || 'home';
    const dropdown = document.getElementById('newInvoiceDropdown');
    const list = document.getElementById('templateDropdownList');
    list.innerHTML = '';
    if (savedTemplates.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dropdown-empty';
        empty.textContent = 'No templates saved yet';
        list.appendChild(empty);
    } else {
        const divider = document.createElement('div');
        divider.className = 'dropdown-divider';
        divider.textContent = 'From template';
        list.appendChild(divider);
        savedTemplates.forEach(template => {
            const item = document.createElement('button');
            item.className = 'dropdown-item';
            item.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#FF6B35" style="flex-shrink:0"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>' + document.createTextNode('').nodeValue;
            const label = document.createTextNode(template.name);
            item.appendChild(label);
            item.onclick = () => newInvoiceFromTemplate(template.id);
            list.appendChild(item);
        });
    }
    const rect = btn.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.classList.add('open');
    setTimeout(() => {
        document.addEventListener('click', closeNewInvoiceDropdown, { once: true });
    }, 0);
}

function closeNewInvoiceDropdown() {
    document.getElementById('newInvoiceDropdown')?.classList.remove('open');
}

function startBlankInvoice() {
    closeNewInvoiceDropdown();
    currentTemplateId = null;
    updateTemplateSaveBtn();
    if (_newInvoiceContext === 'saved') {
        startNewInvoiceInSavedFolder();
    } else if (_newInvoiceContext === 'editor') {
        createNewInvoice();
    } else {
        startNewInvoiceFromHome();
    }
}

// ── End templates ─────────────────────────────────────────────────────────────

function createFolderData(name) {
    return {
        id: 'folder-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name,
        parentId: null
    };
}

function ensureDefaultFolder() {
    if (!savedFolders.length) {
        const defaultFolder = createFolderData('General');
        savedFolders.push(defaultFolder);
        syncFolderToSupabase(defaultFolder);
        saveFolders();
        return defaultFolder.id;
    }
    return savedFolders[0].id;
}

function normalizeInvoiceFolders() {
    const defaultFolderId = ensureDefaultFolder();
    let updated = false;
    savedInvoices = savedInvoices.map(invoice => {
        if (!invoice.folderId) {
            updated = true;
            return { ...invoice, folderId: defaultFolderId };
        }
        return invoice;
    });
    if (updated) {
        saveInvoices();
    }
    savedFolders = savedFolders.map(folder => {
        if (typeof folder.parentId === 'undefined') {
            return { ...folder, parentId: null };
        }
        return folder;
    });
    saveFolders();
    if (!currentFolderId) {
        currentFolderId = defaultFolderId;
    }
}

function getFolderById(folderId) {
    return savedFolders.find(folder => folder.id === folderId) || null;
}

function getFolderPath(folderId) {
    const path = [];
    let current = folderId ? getFolderById(folderId) : null;
    while (current) {
        path.unshift(current);
        current = current.parentId ? getFolderById(current.parentId) : null;
    }
    return path;
}

function getDescendantFolderIds(folderId) {
    const ids = [];
    const stack = [folderId];
    while (stack.length) {
        const currentId = stack.pop();
        ids.push(currentId);
        savedFolders
            .filter(folder => folder.parentId === currentId)
            .forEach(folder => stack.push(folder.id));
    }
    return ids;
}

function getNextInvoiceNumber() {
    const maxNumber = savedInvoices.reduce((max, invoice) => {
        const num = parseInt(invoice.invoiceNumber, 10);
        if (Number.isNaN(num)) {
            return max;
        }
        return Math.max(max, num);
    }, 0);
    return String(maxNumber + 1).padStart(4, '0');
}

function formatCurrency(amount) {
    return '$' + amount.toFixed(2);
}

function getInvoiceTotal(invoice) {
    if (!invoice || !Array.isArray(invoice.items)) {
        return 0;
    }
    return invoice.items.reduce((sum, item) => {
        const qty = parseFloat(item.quantity) || 0;
        const rate = parseFloat(item.rate) || 0;
        return sum + qty * rate;
    }, 0);
}

const printBtnFresh = document.getElementById('printBtnFresh');
if (printBtnFresh) {
    printBtnFresh.addEventListener('click', () => {
        printInvoice();
    });
}

function showHome() {
    document.getElementById('homeView').style.display = 'block';
    document.getElementById('editorView').style.display = 'none';
    document.getElementById('savedView').style.display = 'none';
    document.querySelector('.invoice-actions').style.display = 'none';
}

function showEditor() {
    document.getElementById('homeView').style.display = 'none';
    document.getElementById('editorView').style.display = 'block';
    document.getElementById('savedView').style.display = 'none';
    document.querySelector('.invoice-actions').style.display = 'flex';
}

function showSavedView() {
    document.getElementById('homeView').style.display = 'none';
    document.getElementById('editorView').style.display = 'none';
    document.getElementById('savedView').style.display = 'block';
    document.querySelector('.invoice-actions').style.display = 'none';
}

function addItem(itemData = null) {
    const tbody = document.getElementById('itemsBody');
    const row = tbody.insertRow();
    
    const defaultItem = itemData || {
        description: '',
        quantity: 0,
        rate: 0
    };

    row.innerHTML = `
        <td><input type="text" class="item-input" placeholder="Item description" value="${defaultItem.description}" onchange="calculateTotals()"></td>
        <td><input type="number" class="item-input qty-input" min="0" value="${defaultItem.quantity}" onchange="calculateTotals()"></td>
        <td><input type="number" class="item-input rate-input" min="0" step="0.01" value="${defaultItem.rate}" onchange="calculateTotals()"></td>
        <td class="amount-display"><span class="currency-symbol">$</span><span class="amount">0.00</span></td>
        <td><button class="btn-remove" onclick="removeItem(this)">×</button></td>
    `;
    
    calculateTotals();
}

function clearItemData() {
    const rows = document.querySelectorAll('#itemsBody tr');
    rows.forEach(row => {
        const qtyInput = row.cells[1].querySelector('input');
        if (qtyInput) {
            qtyInput.value = '';
        }
        const amount = row.querySelector('.amount');
        if (amount) {
            amount.textContent = '0.00';
        }
    });
    calculateTotals();
}

function getDefaultMetaFields() {
    return [
        { key: 'invoiceNumber', label: '#', type: 'text', value: '0454', required: true },
        { key: 'invoiceDate', label: 'DATE:', type: 'date', value: defaultDate, required: true },
        { key: 'projectCode', label: 'PROJECT', type: 'text', value: '', required: false },
        { key: 'supervisor', label: 'Supervisor', type: 'text', value: '', required: false }
    ];
}

function buildMetaFieldsForInvoice(invoice) {
    const existing = Array.isArray(invoice.metaFields) ? invoice.metaFields : [];
    const metaByKey = new Map(existing.map(field => [field.key, field]));
    const baseMeta = getDefaultMetaFields().map(field => {
        const value = field.key === 'invoiceNumber'
            ? (invoice.invoiceNumber || '')
            : field.key === 'invoiceDate'
            ? (invoice.date || defaultDate)
            : field.key === 'projectCode'
            ? (invoice.project || '')
            : field.key === 'supervisor'
            ? (invoice.supervisor || '')
            : field.value;
        const existingField = metaByKey.get(field.key);
        return {
            ...field,
            ...(existingField ? { label: existingField.label, type: existingField.type } : {}),
            value
        };
    });
    const customMeta = existing
        .filter(field => !['invoiceNumber', 'invoiceDate', 'projectCode', 'supervisor'].includes(field.key))
        .map(field => ({ ...field }));
    return [...baseMeta, ...customMeta];
}

function isInvoiceIncomplete(invoice) {
    if (!invoice) {
        return true;
    }
    const hasItems = Array.isArray(invoice.items) && invoice.items.length > 0;
    if (hasItems) {
        return false;
    }
    const hasHeader = Boolean(
        invoice.from ||
        invoice.billTo ||
        invoice.billToAddress
    );
    return !hasHeader;
}

function renderMetaFields(fields) {
    const wrapper = document.getElementById('metaFields');
    if (!wrapper) {
        return;
    }
    wrapper.innerHTML = '';
    fields.forEach(field => {
        const row = document.createElement('div');
        row.className = 'meta-row';
        row.dataset.key = field.key;

        const label = document.createElement('input');
        label.className = 'meta-label-input';
        label.type = 'text';
        label.value = field.label;

        const inline = document.createElement('div');
        inline.className = 'meta-row-inline';

        const input = document.createElement('input');
        input.className = 'meta-value';
        input.type = field.type || 'text';
        input.value = field.value || '';
        if (field.required) {
            input.setAttribute('data-required', 'true');
        }
        input.onchange = () => calculateTotals();

        const actions = document.createElement('div');
        actions.className = 'meta-row-actions';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete-meta';
        deleteBtn.type = 'button';
        deleteBtn.textContent = 'Delete';
        deleteBtn.disabled = field.required;
        deleteBtn.onclick = event => {
            event.stopPropagation();
            removeMetaField(field.key);
        };

        actions.appendChild(deleteBtn);
        inline.appendChild(input);
        inline.appendChild(actions);

        row.appendChild(label);
        row.appendChild(inline);
        wrapper.appendChild(row);
    });
}

function getMetaFieldsFromDOM() {
    const rows = document.querySelectorAll('#metaFields .meta-row');
    return Array.from(rows).map(row => {
        const key = row.dataset.key || '';
        const label = row.querySelector('.meta-label-input')?.value || '';
        const input = row.querySelector('.meta-value');
        return {
            key,
            label,
            type: input ? input.type : 'text',
            value: input ? input.value : '',
            required: input ? input.hasAttribute('data-required') : false
        };
    });
}

function addMetaField() {
    const label = prompt('Field label');
    if (!label) {
        return;
    }
    const trimmed = label.trim();
    if (!trimmed) {
        return;
    }
    const fields = getMetaFieldsFromDOM();
    fields.push({
        key: `custom-${Date.now().toString(36)}`,
        label: trimmed,
        type: 'text',
        value: '',
        required: false
    });
    renderMetaFields(fields);
}

function removeMetaField(key) {
    const fields = getMetaFieldsFromDOM().filter(field => field.key !== key);
    renderMetaFields(fields);
}

function removeItem(button) {
    const row = button.closest('tr');
    row.remove();
    calculateTotals();
}

function calculateTotals() {
    const rows = document.querySelectorAll('#itemsBody tr');
    let subtotal = 0;

    rows.forEach(row => {
        const qty = parseFloat(row.cells[1].querySelector('input').value) || 0;
        const rate = parseFloat(row.cells[2].querySelector('input').value) || 0;
        const amount = qty * rate;
        
        row.querySelector('.amount').textContent = amount.toFixed(2);
        subtotal += amount;
    });

    const total = subtotal;

    document.getElementById('subtotal').textContent = '$' + subtotal.toFixed(2);
    document.getElementById('total').textContent = '$' + total.toFixed(2);
    document.getElementById('balanceDue').textContent = '$' + total.toFixed(2);
}

function collectInvoiceData() {
    const items = [];
    const rows = document.querySelectorAll('#itemsBody tr');
    
    rows.forEach(row => {
        items.push({
            description: row.cells[0].querySelector('input').value,
            quantity: parseFloat(row.cells[1].querySelector('input').value) || 0,
            rate: parseFloat(row.cells[2].querySelector('input').value) || 0
        });
    });

    const metaFields = getMetaFieldsFromDOM();
    const byKey = key => metaFields.find(field => field.key === key)?.value || '';

    return {
        invoiceNumber: byKey('invoiceNumber'),
        date: byKey('invoiceDate'),
        project: byKey('projectCode'),
        supervisor: byKey('supervisor'),
        from: document.getElementById('fromCompany').value,
        billTo: document.getElementById('billToCompany').value,
        billToAddress: document.getElementById('billToAddress').value,
        notes: document.getElementById('invoiceNotes').value,
        items: items,
        metaFields: metaFields,
        paid: savedInvoices.find(inv => inv.invoiceNumber === byKey('invoiceNumber'))?.paid || false
    };
}

function saveInvoice() {
    const data = collectInvoiceData();
    
    // Find if invoice already exists
    const existingIndex = savedInvoices.findIndex(inv => inv.invoiceNumber === data.invoiceNumber);
    
    if (existingIndex >= 0) {
        data.folderId = savedInvoices[existingIndex].folderId || currentFolderId || ensureDefaultFolder();
        savedInvoices[existingIndex] = data;
    } else {
        data.folderId = currentFolderId || ensureDefaultFolder();
        savedInvoices.push(data);
    }
    syncInvoiceToSupabase(data);
    if (pendingDuplicate && data.invoiceNumber === pendingDuplicate.invoiceNumber) {
        pendingDuplicate = null;
    }
    
    saveInvoices();
    currentTemplateId = null;
    updateTemplateSaveBtn();
    alert('Invoice saved successfully!');
    renderSavedInvoices();
}

function loadInvoice(data) {
    lastOpenedFolderId = data.folderId ? String(data.folderId) : null;
    currentFolderId = data.folderId || ensureDefaultFolder();
    currentInvoiceNumber = data.invoiceNumber || null;
    const fields = buildMetaFieldsForInvoice(data);
    renderMetaFields(fields);
    document.getElementById('fromCompany').value = data.from || '';
    document.getElementById('billToCompany').value = data.billTo || '';
    document.getElementById('billToAddress').value = data.billToAddress || '';
    document.getElementById('invoiceNotes').value = data.notes || '';
    
    // Clear existing items
    document.getElementById('itemsBody').innerHTML = '';
    
    // Add items
    data.items.forEach(item => addItem(item));
}

function createNewInvoice() {
    if (confirm('Create a new invoice? Any unsaved changes will be lost.')) {
        // Generate new invoice number
        currentTemplateId = null;
        const newNumber = getNextInvoiceNumber();
        currentInvoiceNumber = newNumber;

        currentFolderId = currentFolderId || ensureDefaultFolder();
        const fields = getDefaultMetaFields().map(field => ({
            ...field,
            value: field.key === 'invoiceNumber'
                ? newNumber
                : field.key === 'invoiceDate'
                ? defaultDate
                : ''
        }));
        renderMetaFields(fields);
        document.getElementById('fromCompany').value = '';
        document.getElementById('billToCompany').value = '';
        document.getElementById('billToAddress').value = '';
        document.getElementById('invoiceNotes').value = '';
        
        // Clear items
        document.getElementById('itemsBody').innerHTML = '';
        
        // Add one empty item
        addItem();
        showEditor();
    }
}

function collectPrintCss() {
    let cssText = '';
    Array.from(document.styleSheets).forEach(sheet => {
        try {
            const rules = sheet.cssRules;
            if (!rules) {
                return;
            }
            Array.from(rules).forEach(rule => {
                cssText += rule.cssText + '\n';
            });
        } catch (error) {
            // Ignore stylesheets we can't read.
        }
    });
    return cssText;
}

function cloneContainerForPrint() {
    const container = document.querySelector('.container');
    let containerHtml = '';
    if (container) {
        const cloned = container.cloneNode(true);
        const originalInputs = container.querySelectorAll('input, textarea, select');
        const clonedInputs = cloned.querySelectorAll('input, textarea, select');
        clonedInputs.forEach((input, index) => {
            const original = originalInputs[index];
            if (!original) {
                return;
            }
            if (input.tagName.toLowerCase() === 'select') {
                const value = original.value;
                Array.from(input.options).forEach(option => {
                    option.selected = option.value === value;
                });
            } else if (input.tagName.toLowerCase() === 'textarea') {
                const value = original.value || '';
                input.value = value;
                input.textContent = value;
            } else {
                input.setAttribute('value', original.value || '');
            }
            input.removeAttribute('placeholder');
        });
        const rows = cloned.querySelectorAll('#itemsBody tr');
        rows.forEach(row => {
            const qtyInput = row.querySelector('.qty-input');
            const qty = qtyInput ? parseFloat(qtyInput.value) : 0;
            if (!qty || qty <= 0) {
                row.remove();
            }
        });
        const notesTextarea = cloned.querySelector('#invoiceNotes');
        const notesSection = notesTextarea ? notesTextarea.closest('.notes-section') : null;
        if (notesSection && (!notesTextarea.value || !notesTextarea.value.trim())) {
            notesSection.remove();
        }
        containerHtml = cloned.outerHTML;
    }
    return containerHtml;
}

function renderPrintHtml(containerHtml, title = 'Invoice') {
    const cssText = collectPrintCss();
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>${cssText}</style>
</head>
<body>
${containerHtml}
</body>
</html>`;
    return html;
}

function printInvoice() {
    // Firefox can block window.open; print via a hidden iframe without injected scripts.
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');

    const containerHtml = cloneContainerForPrint();
    const metaForPrint = getMetaFieldsFromDOM();
    const projectForPrint = metaForPrint.find(f => f.key === 'projectCode')?.value || '';
    const numberForPrint = metaForPrint.find(f => f.key === 'invoiceNumber')?.value || '';
    const printTitle = [projectForPrint, numberForPrint].filter(Boolean).join(' --- ') || 'Invoice';
    const html = renderPrintHtml(containerHtml, printTitle);

    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    if (!win) {
        window.print();
        iframe.remove();
        return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 500);
}

function printFolderInvoices() {
    const folderId = currentSavedFolderId ? String(currentSavedFolderId) : null;
    const invoicesHere = savedInvoices.filter(inv => String(inv.folderId || '') === String(folderId || ''));
    if (!invoicesHere.length) {
        alert('No invoices in this folder to print.');
        return;
    }

    const homeView = document.getElementById('homeView');
    const editorView = document.getElementById('editorView');
    const savedView = document.getElementById('savedView');
    const actions = document.querySelector('.invoice-actions');
    const previousState = {
        home: homeView ? homeView.style.display : '',
        editor: editorView ? editorView.style.display : '',
        saved: savedView ? savedView.style.display : '',
        actions: actions ? actions.style.display : ''
    };
    const previousInvoice = collectInvoiceData();
    const previousInvoiceNumber = currentInvoiceNumber;
    const previousFolderId = currentFolderId;
    const previousLastOpened = lastOpenedFolderId;

    showEditor();

    const containers = invoicesHere.map(invoice => {
        loadInvoice(invoice);
        return cloneContainerForPrint();
    });

    if (previousInvoiceNumber) {
        loadInvoice(previousInvoice);
    }
    currentInvoiceNumber = previousInvoiceNumber;
    currentFolderId = previousFolderId;
    lastOpenedFolderId = previousLastOpened;

    if (previousState.home === 'block') {
        showHome();
    } else if (previousState.saved === 'block') {
        showSavedView();
        renderSavedView();
    } else {
        showEditor();
    }

    if (homeView) {
        homeView.style.display = previousState.home;
    }
    if (editorView) {
        editorView.style.display = previousState.editor;
    }
    if (savedView) {
        savedView.style.display = previousState.saved;
    }
    if (actions) {
        actions.style.display = previousState.actions;
    }

    const combinedHtml = containers
        .map((html, index) => index === 0 ? html : `<div style="page-break-before: always;"></div>${html}`)
        .join('');

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');

    const title = folderId ? 'Folder Invoices' : 'Saved Invoices';
    const html = renderPrintHtml(combinedHtml, title);
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    if (!win) {
        window.print();
        iframe.remove();
        return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 500);
}


function startNewInvoiceFromHome() {
    // Create a fresh invoice without a confirm dialog from the home view.
    currentTemplateId = null;
    const newNumber = getNextInvoiceNumber();
    currentInvoiceNumber = newNumber;
    currentFolderId = ensureDefaultFolder();
    const fields = getDefaultMetaFields().map(field => ({
        ...field,
        value: field.key === 'invoiceNumber'
            ? newNumber
            : field.key === 'invoiceDate'
            ? defaultDate
            : ''
    }));
    renderMetaFields(fields);
    document.getElementById('fromCompany').value = '';
    document.getElementById('billToCompany').value = '';
    document.getElementById('billToAddress').value = '';
    document.getElementById('invoiceNotes').value = '';
    document.getElementById('itemsBody').innerHTML = '';
    addItem();
    showEditor();
}

function startNewInvoiceInSavedFolder() {
    const targetFolderId = currentSavedFolderId || ensureDefaultFolder();
    currentFolderId = targetFolderId;
    lastOpenedFolderId = targetFolderId;
    currentTemplateId = null;
    const newNumber = getNextInvoiceNumber();
    currentInvoiceNumber = newNumber;
    const fields = getDefaultMetaFields().map(field => ({
        ...field,
        value: field.key === 'invoiceNumber'
            ? newNumber
            : field.key === 'invoiceDate'
            ? defaultDate
            : ''
    }));
    renderMetaFields(fields);
    document.getElementById('fromCompany').value = '';
    document.getElementById('billToCompany').value = '';
    document.getElementById('billToAddress').value = '';
    document.getElementById('invoiceNotes').value = '';
    document.getElementById('itemsBody').innerHTML = '';
    addItem();
    showEditor();
}

function renderSavedInvoices() {
    renderSavedView();
}

function openInvoiceEditor() {
    showEditor();
}

function showSavedInvoices() {
    openSavedInvoicesView();
}

function goHome() {
    showHome();
}

function createFolder() {
    const input = document.getElementById('folderNameInput');
    if (!input) {
        return;
    }
    const trimmed = input.value.trim();
    if (!trimmed) {
        return;
    }
    const folder = createFolderData(trimmed);
    folder.parentId = currentSavedFolderId ? String(currentSavedFolderId) : null;
    savedFolders.push(folder);
    syncFolderToSupabase(folder);
    saveFolders();
    input.value = '';
    cancelFolderCreate();
    renderSavedView();
}

function moveInvoice(invoiceNumber, targetFolderId, beforeInvoiceNumber = null) {
    if (!invoiceNumber || !targetFolderId) {
        return;
    }
    const fromIndex = savedInvoices.findIndex(inv => inv.invoiceNumber === invoiceNumber);
    if (fromIndex < 0) {
        return;
    }
    const invoice = savedInvoices[fromIndex];
    const targetIndex = beforeInvoiceNumber
        ? savedInvoices.findIndex(inv => inv.invoiceNumber === beforeInvoiceNumber)
        : -1;

    let insertIndex = targetIndex >= 0 ? targetIndex : savedInvoices.length;
    if (fromIndex < insertIndex) {
        insertIndex -= 1;
    }
    savedInvoices.splice(fromIndex, 1);
    invoice.folderId = targetFolderId;
    savedInvoices.splice(insertIndex, 0, invoice);
    syncInvoiceToSupabase(invoice);
    saveInvoices();
    renderSavedView();
}

renderMetaFields(getDefaultMetaFields());

function isDescendant(folderId, potentialParentId) {
    if (!folderId || !potentialParentId) {
        return false;
    }
    let current = getFolderById(potentialParentId);
    while (current) {
        if (current.id === folderId) {
            return true;
        }
        current = current.parentId ? getFolderById(current.parentId) : null;
    }
    return false;
}

function moveFolder(folderId, targetFolderId) {
    if (!folderId) {
        return;
    }
    if (folderId === targetFolderId) {
        return;
    }
    if (isDescendant(folderId, targetFolderId)) {
        return;
    }
    const folder = getFolderById(folderId);
    if (!folder) {
        return;
    }
    folder.parentId = targetFolderId || null;
    syncFolderToSupabase(folder);
    saveFolders();
    renderSavedView();
}

function renderSavedView() {
    normalizeInvoiceFolders();
    const list = document.getElementById('savedList');
    const breadcrumbs = document.getElementById('savedBreadcrumbs');
    list.innerHTML = '';
    breadcrumbs.innerHTML = '';
    updateUndoBar();

    const path = getFolderPath(currentSavedFolderId);
    const rootButton = document.createElement('button');
    rootButton.textContent = 'Saved Invoices';
    rootButton.onclick = () => navigateFolder(null);
    breadcrumbs.appendChild(rootButton);
    path.forEach(folder => {
        const sep = document.createElement('span');
        sep.textContent = ' / ';
        breadcrumbs.appendChild(sep);
        const crumb = document.createElement('button');
        crumb.textContent = folder.name;
        crumb.onclick = () => navigateFolder(folder.id);
        breadcrumbs.appendChild(crumb);
    });

    const currentId = currentSavedFolderId ? String(currentSavedFolderId) : null;
    const foldersHere = savedFolders.filter(folder => String(folder.parentId || '') === String(currentId || ''));
    const invoicesHere = savedInvoices.filter(inv => String(inv.folderId || '') === String(currentId || ''));
    const templatesVisible = !currentSavedFolderId && savedTemplates.length > 0;

    if (!foldersHere.length && !invoicesHere.length && !templatesVisible) {
        const empty = document.createElement('div');
        empty.className = 'invoice-empty';
        empty.textContent = 'No items here yet.';
        list.appendChild(empty);
        return;
    }

    // ── Templates section (root level only) ──────────────────────────────────
    if (templatesVisible) {
        const sec = document.createElement('div');
        sec.className = 'list-section-header';
        sec.textContent = 'Templates';
        list.appendChild(sec);

        savedTemplates.forEach(template => {
            const item = document.createElement('div');
            item.className = 'saved-item template-item';
            item.onclick = () => {
                if (suppressClick) { suppressClick = false; return; }
                editTemplate(template.id);
            };

            const icon = document.createElement('div');
            icon.className = 'item-type-icon';
            icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#FF6B35" d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>';

            const title = document.createElement('div');
            title.className = 'saved-item-title';
            title.textContent = template.name;

            const info = document.createElement('div');
            info.className = 'saved-item-info';
            info.appendChild(title);

            const actions = document.createElement('div');
            actions.className = 'saved-item-actions';

            const useBtn = document.createElement('button');
            useBtn.textContent = 'Use';
            useBtn.onclick = event => {
                event.stopPropagation();
                currentFolderId = currentFolderId || ensureDefaultFolder();
                newInvoiceFromTemplate(template.id);
            };

            const renameBtn = document.createElement('button');
            renameBtn.className = 'menu';
            renameBtn.textContent = 'Rename';
            renameBtn.onclick = event => { event.stopPropagation(); renameTemplate(template.id); };

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'danger';
            deleteBtn.textContent = 'Delete';
            deleteBtn.onclick = event => { event.stopPropagation(); deleteTemplate(template.id); };

            actions.appendChild(useBtn);
            actions.appendChild(renameBtn);
            actions.appendChild(deleteBtn);

            item.appendChild(icon);
            item.appendChild(info);
            item.appendChild(actions);
            list.appendChild(item);
        });
    }

    if (foldersHere.length > 0) {
        const sec = document.createElement('div');
        sec.className = 'list-section-header';
        sec.textContent = 'Folders';
        list.appendChild(sec);
    }

    foldersHere.forEach(folder => {
        const item = document.createElement('div');
        item.className = 'saved-item folder-item';
        item.dataset.folderId = folder.id;
        item.onclick = () => {
            if (suppressClick) {
                suppressClick = false;
                return;
            }
            navigateFolder(folder.id);
        };

        item.addEventListener('mousedown', event => {
            if (event.button !== 0) {
                return;
            }
            if (event.target.closest('.saved-item-actions')) {
                return;
            }
            startManualDrag(item, 'folder', folder.id, event);
        });

        const icon = document.createElement('div');
        icon.className = 'item-type-icon';
        icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#FF6B35" xmlns="http://www.w3.org/2000/svg"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>';

        const title = document.createElement('div');
        title.className = 'saved-item-title';
        title.textContent = folder.name;

        const meta = document.createElement('div');
        meta.className = 'saved-item-meta';
        const folderInvoices = savedInvoices.filter(inv => String(inv.folderId || '') === String(folder.id || ''));
        const count = folderInvoices.length;
        const total = folderInvoices.reduce((sum, inv) => sum + getInvoiceTotal(inv), 0);
        const countSpan = document.createElement('span');
        countSpan.textContent = `${count} invoice${count === 1 ? '' : 's'}`;
        const totalSpan = document.createElement('span');
        totalSpan.textContent = formatCurrency(total);
        meta.appendChild(countSpan);
        meta.appendChild(totalSpan);

        const info = document.createElement('div');
        info.className = 'saved-item-info';
        info.appendChild(title);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'saved-item-actions';

        const renameBtn = document.createElement('button');
        renameBtn.className = 'menu';
        renameBtn.textContent = 'Rename';
        renameBtn.onclick = event => {
            event.stopPropagation();
            renameFolder(folder.id);
        };

        const duplicateBtn = document.createElement('button');
        duplicateBtn.textContent = 'Duplicate';
        duplicateBtn.onclick = event => {
            event.stopPropagation();
            duplicateFolder(folder.id);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = event => {
            event.stopPropagation();
            deleteFolder(folder.id);
        };

        actions.appendChild(renameBtn);
        actions.appendChild(duplicateBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(icon);
        item.appendChild(info);
        item.appendChild(actions);
        list.appendChild(item);
    });

    if (invoicesHere.length > 0) {
        const sec = document.createElement('div');
        sec.className = 'list-section-header';
        sec.textContent = 'Invoices';
        list.appendChild(sec);
    }

    invoicesHere.forEach(invoice => {
        const item = document.createElement('div');
        item.className = `saved-item invoice-item ${invoice.paid ? 'paid' : 'unpaid'}`;
        item.dataset.invoiceNumber = invoice.invoiceNumber;
        item.onclick = () => {
            if (suppressClick) {
                suppressClick = false;
                return;
            }
            currentTemplateId = null;
            updateTemplateSaveBtn();
            loadInvoice(invoice);
            showEditor();
        };

        item.addEventListener('mousedown', event => {
            if (event.button !== 0) {
                return;
            }
            if (event.target.closest('.saved-item-actions')) {
                return;
            }
            startManualDrag(item, 'invoice', invoice.invoiceNumber, event);
        });

        const icon = document.createElement('div');
        icon.className = 'item-type-icon';
        icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#5f6368" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';

        const title = document.createElement('div');
        title.className = 'saved-item-title';
        title.textContent = `#${invoice.invoiceNumber} · ${invoice.project || '—'}`;

        const meta = document.createElement('div');
        meta.className = 'saved-item-meta';
        const date = document.createElement('span');
        date.textContent = invoice.date || '';
        const amountSpan = document.createElement('span');
        amountSpan.textContent = formatCurrency(getInvoiceTotal(invoice));
        meta.appendChild(date);
        meta.appendChild(amountSpan);

        const info = document.createElement('div');
        info.className = 'saved-item-info';
        info.appendChild(title);
        info.appendChild(meta);

        const badge = document.createElement('div');
        badge.className = `item-paid-badge ${invoice.paid ? 'is-paid' : 'is-unpaid'}`;
        badge.textContent = invoice.paid ? 'Paid' : 'Unpaid';

        const actions = document.createElement('div');
        actions.className = 'saved-item-actions';

        const duplicateBtn = document.createElement('button');
        duplicateBtn.textContent = 'Duplicate';
        duplicateBtn.onclick = event => {
            event.stopPropagation();
            duplicateInvoice(invoice.invoiceNumber);
        };

        const paidBtn = document.createElement('button');
        paidBtn.textContent = invoice.paid ? 'Mark Unpaid' : 'Mark Paid';
        paidBtn.onclick = event => {
            event.stopPropagation();
            toggleInvoicePaid(invoice.invoiceNumber);
        };

        const moveBtn = document.createElement('button');
        moveBtn.className = 'menu';
        moveBtn.textContent = 'Move';
        moveBtn.onclick = event => {
            event.stopPropagation();
            openMoveDialog(invoice.invoiceNumber);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = event => {
            event.stopPropagation();
            deleteInvoice(invoice.invoiceNumber);
        };

        actions.appendChild(duplicateBtn);
        actions.appendChild(moveBtn);
        actions.appendChild(paidBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(icon);
        item.appendChild(info);
        item.appendChild(badge);
        item.appendChild(actions);
        list.appendChild(item);
    });

}

function navigateFolder(folderId) {
    currentSavedFolderId = folderId ? String(folderId) : null;
    renderSavedView();
}

function openSavedInvoicesView() {
    currentSavedFolderId = null;
    showSavedView();
    loadStateFromSupabase().then(() => {
        normalizeInvoiceFolders();
        renderSavedView();
    });
}

function goBackToFolder() {
    if (!lastOpenedFolderId) {
        openSavedInvoicesView();
        return;
    }
    currentSavedFolderId = lastOpenedFolderId;
    showSavedView();
    renderSavedView();
}

function openFolderCreator() {
    const bar = document.getElementById('folderCreate');
    const input = document.getElementById('folderNameInput');
    if (!bar || !input) {
        return;
    }
    bar.style.display = 'flex';
    input.focus();
}

function submitFolderCreate() {
    createFolder();
}

function cancelFolderCreate() {
    const bar = document.getElementById('folderCreate');
    const input = document.getElementById('folderNameInput');
    if (bar) {
        bar.style.display = 'none';
    }
    if (input) {
        input.value = '';
    }
}

function setUndoSnapshot(snapshot) {
    const clone = JSON.parse(JSON.stringify(snapshot));
    deleteHistory.push(clone);
    saveDeleteHistory();
    updateUndoBar();
}

function showUndoBar(snapshot) {
    const bar = document.getElementById('undoBar');
    const message = document.getElementById('undoMessage');
    if (!bar || !message) {
        return;
    }
    if (snapshot.type === 'invoice') {
        const label = snapshot.label || 'Invoice';
        message.textContent = `${label} deleted. Undo will restore it.`;
    } else {
        const label = snapshot.label || 'Folder';
        message.textContent = `${label} deleted. Undo will restore it and its contents.`;
    }
}

function undoDelete() {
    const snapshot = deleteHistory.pop();
    if (!snapshot) {
        updateUndoBar();
        return;
    }
    const { folders, invoices } = snapshot;
    folders.forEach(folder => {
        if (!savedFolders.find(f => f.id === folder.id)) {
            savedFolders.push(folder);
        }
    });
    invoices.forEach(invoice => {
        if (!savedInvoices.find(inv => inv.invoiceNumber === invoice.invoiceNumber)) {
            savedInvoices.push(invoice);
        }
    });
    saveFolders();
    saveInvoices();
    saveDeleteHistory();
    updateUndoBar();
    renderSavedView();
}

function updateUndoBar() {
    const bar = document.getElementById('undoBar');
    const message = document.getElementById('undoMessage');
    const button = bar ? bar.querySelector('button') : null;
    if (!bar || !message || !button) {
        return;
    }
    if (!deleteHistory.length) {
        message.textContent = 'No deletions to undo.';
        button.disabled = true;
        return;
    }
    button.disabled = false;
    const last = deleteHistory[deleteHistory.length - 1];
    showUndoBar(last);
}

function initSupabase() {
    if (!window.supabase) {
        return;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function markInvoiceDirty(invoiceNumber) {
    if (!invoiceNumber) {
        return;
    }
}

function markInvoiceDeleted(invoiceNumber) {
    if (!invoiceNumber) {
        return;
    }
}

function markFolderDirty(folderId) {
    if (!folderId) {
        return;
    }
}

function markFolderDeleted(folderId) {
    if (!folderId) {
        return;
    }
}

function scheduleSupabaseSync() {
    // Supabase-first: avoid bulk sync to prevent accidental overwrites.
    return;
}

async function persistStateToSupabase() {
    return;
}

async function syncInvoiceToSupabase(invoice) {
    if (!supabaseClient || !allowSupabaseSync || !invoice || !invoice.invoiceNumber) {
        return;
    }
    const workspaceId = WORKSPACE_ID;
    const now = new Date().toISOString();
    try {
        const { error: invoiceError } = await supabaseClient
            .from('invoices')
            .upsert(
                {
                    workspace_id: workspaceId,
                    invoice_number: String(invoice.invoiceNumber),
                    date: invoice.date || null,
                    project: invoice.project || '',
                    supervisor: invoice.supervisor || '',
                    from_company: invoice.from || '',
                    bill_to: invoice.billTo || '',
                    bill_to_address: invoice.billToAddress || '',
                    notes: invoice.notes || '',
                    meta_fields: Array.isArray(invoice.metaFields) ? invoice.metaFields : [],
                    paid: Boolean(invoice.paid),
                    folder_id: invoice.folderId ? String(invoice.folderId) : null,
                    updated_at: now
                },
                { onConflict: 'workspace_id,invoice_number' }
            );
        if (invoiceError) {
            console.warn('Supabase invoice upsert failed', invoiceError);
            return;
        }
        const { error: deleteError } = await supabaseClient
            .from('invoice_items')
            .delete()
            .eq('workspace_id', workspaceId)
            .eq('invoice_number', String(invoice.invoiceNumber));
        if (deleteError) {
            console.warn('Supabase item delete failed', deleteError);
        }
        if (Array.isArray(invoice.items) && invoice.items.length) {
            const itemsPayload = invoice.items.map((item, index) => ({
                workspace_id: workspaceId,
                invoice_number: String(invoice.invoiceNumber),
                position: index,
                description: item.description || '',
                quantity: Number(item.quantity) || 0,
                rate: Number(item.rate) || 0
            }));
            const { error: insertError } = await supabaseClient
                .from('invoice_items')
                .insert(itemsPayload);
            if (insertError) {
                console.warn('Supabase item insert failed', insertError);
            }
        }
    } catch (error) {
        console.warn('Supabase invoice sync failed', error);
    }
}

async function deleteInvoiceFromSupabase(invoiceNumber) {
    if (!supabaseClient || !allowSupabaseSync || !invoiceNumber) {
        return;
    }
    try {
        const { error } = await supabaseClient
            .from('invoices')
            .delete()
            .eq('workspace_id', WORKSPACE_ID)
            .eq('invoice_number', String(invoiceNumber));
        if (error) {
            console.warn('Supabase invoice delete failed', error);
        }
    } catch (error) {
        console.warn('Supabase invoice delete failed', error);
    }
}

async function syncFolderToSupabase(folder) {
    if (!supabaseClient || !allowSupabaseSync || !folder) {
        return;
    }
    const now = new Date().toISOString();
    try {
        const { error } = await supabaseClient
            .from('invoice_folders')
            .upsert(
                {
                    workspace_id: WORKSPACE_ID,
                    id: String(folder.id),
                    name: folder.name || '',
                    parent_id: folder.parentId ? String(folder.parentId) : null,
                    updated_at: now
                },
                { onConflict: 'workspace_id,id' }
            );
        if (error) {
            console.warn('Supabase folder upsert failed', error);
        }
    } catch (error) {
        console.warn('Supabase folder sync failed', error);
    }
}

async function deleteFolderFromSupabase(folderId) {
    if (!supabaseClient || !allowSupabaseSync || !folderId) {
        return;
    }
    try {
        const { error } = await supabaseClient
            .from('invoice_folders')
            .delete()
            .eq('workspace_id', WORKSPACE_ID)
            .eq('id', String(folderId));
        if (error) {
            console.warn('Supabase folder delete failed', error);
        }
    } catch (error) {
        console.warn('Supabase folder delete failed', error);
    }
}

async function syncTemplateToSupabase(template) {
    if (!supabaseClient || !allowSupabaseSync || !template || !template.id) {
        return;
    }
    try {
        const { error } = await supabaseClient
            .from('invoice_templates')
            .upsert(
                {
                    workspace_id: WORKSPACE_ID,
                    id: template.id,
                    name: template.name || '',
                    from_company: template.from || '',
                    bill_to: template.billTo || '',
                    bill_to_address: template.billToAddress || '',
                    notes: template.notes || '',
                    project: template.project || '',
                    supervisor: template.supervisor || '',
                    meta_fields: Array.isArray(template.metaFields) ? template.metaFields : [],
                    items: Array.isArray(template.items) ? template.items : [],
                    updated_at: new Date().toISOString()
                },
                { onConflict: 'workspace_id,id' }
            );
        if (error) {
            console.warn('Supabase template sync failed', error);
        }
    } catch (error) {
        console.warn('Supabase template sync failed', error);
    }
}

async function deleteTemplateFromSupabase(templateId) {
    if (!supabaseClient || !allowSupabaseSync || !templateId) {
        return;
    }
    try {
        const { error } = await supabaseClient
            .from('invoice_templates')
            .delete()
            .eq('workspace_id', WORKSPACE_ID)
            .eq('id', templateId);
        if (error) {
            console.warn('Supabase template delete failed', error);
        }
    } catch (error) {
        console.warn('Supabase template delete failed', error);
    }
}

async function loadStateFromSupabase() {
    if (!supabaseClient) {
        return;
    }
    try {
        const workspaceId = WORKSPACE_ID;
        const [foldersRes, invoicesRes, itemsRes, templatesRes] = await Promise.all([
            supabaseClient
                .from('invoice_folders')
                .select('id, name, parent_id')
                .eq('workspace_id', workspaceId),
            supabaseClient
                .from('invoices')
                .select('invoice_number, date, project, supervisor, from_company, bill_to, bill_to_address, notes, meta_fields, paid, folder_id')
                .eq('workspace_id', workspaceId),
            supabaseClient
                .from('invoice_items')
                .select('invoice_number, position, description, quantity, rate')
                .eq('workspace_id', workspaceId)
                .order('position', { ascending: true }),
            supabaseClient
                .from('invoice_templates')
                .select('id, name, from_company, bill_to, bill_to_address, notes, project, supervisor, meta_fields, items')
                .eq('workspace_id', workspaceId)
        ]);
        if (foldersRes.error || invoicesRes.error) {
            console.warn('Supabase load failed', foldersRes.error || invoicesRes.error);
            throw foldersRes.error || invoicesRes.error;
        }
        if (itemsRes.error) {
            console.warn('Supabase items load failed', itemsRes.error);
        }
        const foldersData = foldersRes.data || [];
        const invoicesData = invoicesRes.data || [];
        const itemsData = itemsRes.error ? [] : (itemsRes.data || []);
        const hasRemoteData = Boolean(foldersData.length || invoicesData.length || itemsData.length);
        if (!hasRemoteData) {
            const legacyLoaded = await loadLegacyStateFromSupabase();
            if (legacyLoaded) {
                remoteStateLoaded = true;
                allowSupabaseSync = true;
                scheduleSupabaseSync();
                return;
            }
            if (savedInvoices.length || savedFolders.length) {
                allowSupabaseSync = true;
                scheduleSupabaseSync();
            }
            return;
        }
        const itemsByInvoice = new Map();
        itemsData.forEach(item => {
            const key = String(item.invoice_number || '');
            if (!itemsByInvoice.has(key)) {
                itemsByInvoice.set(key, []);
            }
            itemsByInvoice.get(key).push({
                description: item.description || '',
                quantity: Number(item.quantity) || 0,
                rate: Number(item.rate) || 0
            });
        });
        const remoteFolders = foldersData.map(folder => ({
            id: String(folder.id),
            name: folder.name || '',
            parentId: folder.parent_id ? String(folder.parent_id) : null
        }));
        const remoteInvoices = invoicesData.map(invoice => ({
            invoiceNumber: String(invoice.invoice_number || ''),
            date: invoice.date || '',
            project: invoice.project || '',
            supervisor: invoice.supervisor || '',
            from: invoice.from_company || '',
            billTo: invoice.bill_to || '',
            billToAddress: invoice.bill_to_address || '',
            notes: invoice.notes || '',
            items: itemsByInvoice.get(String(invoice.invoice_number || '')) || [],
            metaFields: Array.isArray(invoice.meta_fields) ? invoice.meta_fields : [],
            paid: Boolean(invoice.paid),
            folderId: invoice.folder_id ? String(invoice.folder_id) : null
        }));
        remoteInvoices.forEach(inv => {
            inv.metaFields = buildMetaFieldsForInvoice(inv);
            // If Supabase has no items for this invoice but localStorage does,
            // keep the local items — this protects against a failed item sync
            // (delete succeeded but insert failed) silently wiping rows.
            if (inv.items.length === 0) {
                const localInv = savedInvoices.find(l => l.invoiceNumber === inv.invoiceNumber);
                if (localInv && Array.isArray(localInv.items) && localInv.items.length > 0) {
                    inv.items = localInv.items;
                }
            }
        });
        savedFolders = remoteFolders;
        savedInvoices = remoteInvoices;
        if (!templatesRes.error && Array.isArray(templatesRes.data) && templatesRes.data.length > 0) {
            savedTemplates = templatesRes.data.map(t => ({
                id: t.id,
                name: t.name || '',
                from: t.from_company || '',
                billTo: t.bill_to || '',
                billToAddress: t.bill_to_address || '',
                notes: t.notes || '',
                project: t.project || '',
                supervisor: t.supervisor || '',
                metaFields: Array.isArray(t.meta_fields) ? t.meta_fields : [],
                items: Array.isArray(t.items) ? t.items : []
            }));
            localStorage.setItem('invoiceTemplates', JSON.stringify(savedTemplates));
        }
        remoteStateLoaded = true;
        allowSupabaseSync = true;
        localStorage.setItem('invoices', JSON.stringify(savedInvoices));
        localStorage.setItem('invoiceFolders', JSON.stringify(savedFolders));
        localStorage.setItem('invoiceDeleteHistory', JSON.stringify(deleteHistory));
    } catch (error) {
        const legacyLoaded = await loadLegacyStateFromSupabase();
        if (legacyLoaded) {
            remoteStateLoaded = true;
            allowSupabaseSync = true;
            scheduleSupabaseSync();
        }
    }
}

async function loadLegacyStateFromSupabase() {
    try {
        const { data } = await supabaseClient
            .from('invoice_state')
            .select('state')
            .eq('workspace_id', WORKSPACE_ID)
            .single();
        if (data && data.state) {
            savedInvoices = data.state.invoices || [];
            savedFolders = data.state.folders || [];
            deleteHistory = data.state.deleteHistory || [];
            localStorage.setItem('invoices', JSON.stringify(savedInvoices));
            localStorage.setItem('invoiceFolders', JSON.stringify(savedFolders));
            localStorage.setItem('invoiceDeleteHistory', JSON.stringify(deleteHistory));
            return true;
        }
    } catch (error) {
        // Ignore fetch errors; localStorage remains the source.
    }
    return false;
}

function deleteInvoice(invoiceNumber) {
    const invoice = savedInvoices.find(inv => inv.invoiceNumber === invoiceNumber);
    if (!invoice) {
        return;
    }
    setUndoSnapshot({
        type: 'invoice',
        label: `Invoice #${invoiceNumber}`,
        invoices: [invoice],
        folders: []
    });
    savedInvoices = savedInvoices.filter(inv => inv.invoiceNumber !== invoiceNumber);
    deleteInvoiceFromSupabase(invoiceNumber);
    saveInvoices();
    renderSavedView();
}

function duplicateInvoice(invoiceNumber) {
    const invoice = savedInvoices.find(inv => inv.invoiceNumber === invoiceNumber);
    if (!invoice) {
        return;
    }
    copyInvoiceAsNew(invoice);
}

function copyInvoiceAsNew(invoice) {
    const newNumber = getNextInvoiceNumber();
    const copy = {
        ...invoice,
        invoiceNumber: newNumber,
        items: Array.isArray(invoice.items)
            ? invoice.items.map(item => ({ ...item }))
            : [],
        paid: false
    };
    copy.metaFields = buildMetaFieldsForInvoice(copy);
    pendingDuplicate = copy;
    loadInvoice(copy);
    showEditor();
}

function toggleInvoicePaid(invoiceNumber) {
    const invoice = savedInvoices.find(inv => inv.invoiceNumber === invoiceNumber);
    if (!invoice) {
        return;
    }
    invoice.paid = !invoice.paid;
    syncInvoiceToSupabase(invoice);
    saveInvoices();
    renderSavedView();
    if (currentInvoiceNumber && currentInvoiceNumber === invoiceNumber) {
        const banner = document.getElementById('paidBanner');
        if (banner) {
            banner.classList.toggle('paid', invoice.paid);
            banner.textContent = invoice.paid ? 'Paid' : 'Unpaid';
        }
    }
}

function openMoveDialog(invoiceNumber) {
    moveDialogInvoiceNumber = invoiceNumber;
    const invoice = savedInvoices.find(inv => inv.invoiceNumber === invoiceNumber);
    moveDialogFolderId = invoice ? String(invoice.folderId || '') || null : null;
    renderMoveDialog();
    const dialog = document.getElementById('moveDialog');
    if (dialog) {
        dialog.classList.add('open');
    }
}

function closeMoveDialog() {
    const dialog = document.getElementById('moveDialog');
    if (dialog) {
        dialog.classList.remove('open');
    }
    moveDialogInvoiceNumber = null;
    moveDialogFolderId = null;
}

function renderMoveDialog() {
    renderMoveBreadcrumbs();
    renderMoveFolderList();
}

function renderMoveBreadcrumbs() {
    const breadcrumbs = document.getElementById('moveBreadcrumbs');
    if (!breadcrumbs) {
        return;
    }
    breadcrumbs.innerHTML = '';
    const rootBtn = document.createElement('button');
    rootBtn.textContent = 'Saved Invoices';
    rootBtn.onclick = () => {
        moveDialogFolderId = null;
        renderMoveDialog();
    };
    breadcrumbs.appendChild(rootBtn);

    const path = getFolderPath(moveDialogFolderId);
    path.forEach(folder => {
        const sep = document.createElement('span');
        sep.textContent = ' / ';
        breadcrumbs.appendChild(sep);
        const crumb = document.createElement('button');
        crumb.textContent = folder.name;
        crumb.onclick = () => {
            moveDialogFolderId = folder.id;
            renderMoveDialog();
        };
        breadcrumbs.appendChild(crumb);
    });
}

function renderMoveFolderList() {
    const list = document.getElementById('moveFolderList');
    if (!list) {
        return;
    }
    list.innerHTML = '';

    const foldersHere = savedFolders.filter(folder => String(folder.parentId || '') === String(moveDialogFolderId || ''));
    if (!foldersHere.length) {
        const empty = document.createElement('div');
        empty.className = 'invoice-empty';
        empty.textContent = 'No folders here.';
        list.appendChild(empty);
        return;
    }

    foldersHere.forEach(folder => {
        const item = document.createElement('div');
        item.className = 'move-dialog-item';

        const label = document.createElement('span');
        label.textContent = folder.name;

        const actions = document.createElement('div');
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.textContent = 'Open';
        openBtn.onclick = event => {
            event.stopPropagation();
            moveDialogFolderId = folder.id;
            renderMoveDialog();
        };

        const moveBtn = document.createElement('button');
        moveBtn.type = 'button';
        moveBtn.textContent = 'Move';
        moveBtn.onclick = event => {
            event.stopPropagation();
            if (moveDialogInvoiceNumber) {
                moveInvoice(moveDialogInvoiceNumber, folder.id);
                closeMoveDialog();
            }
        };

        actions.appendChild(openBtn);
        actions.appendChild(moveBtn);

        item.appendChild(label);
        item.appendChild(actions);
        list.appendChild(item);
    });
}

function deleteFolder(folderId) {
    const folder = getFolderById(folderId);
    if (!folder) {
        return;
    }
    const folderIds = getDescendantFolderIds(folderId).map(id => String(id));
    const folderIdSet = new Set(folderIds);
    const deletedFolders = savedFolders.filter(f => folderIdSet.has(String(f.id)));
    const deletedInvoices = savedInvoices.filter(inv => folderIdSet.has(String(inv.folderId)));
    setUndoSnapshot({
        type: 'folder',
        label: folder.name || 'Folder',
        folders: deletedFolders,
        invoices: deletedInvoices
    });
    savedFolders = savedFolders.filter(f => !folderIdSet.has(String(f.id)));
    savedInvoices = savedInvoices.filter(inv => !folderIdSet.has(String(inv.folderId)));
    deletedFolders.forEach(deleted => deleteFolderFromSupabase(deleted.id));
    deletedInvoices.forEach(deleted => deleteInvoiceFromSupabase(deleted.invoiceNumber));
    saveFolders();
    saveInvoices();
    if (currentSavedFolderId && folderIds.includes(currentSavedFolderId)) {
        currentSavedFolderId = null;
    }
    renderSavedView();
}

function duplicateFolder(folderId) {
    const folder = getFolderById(folderId);
    if (!folder) {
        return;
    }
    const folderIds = getDescendantFolderIds(folderId);
    const idMap = new Map();

    folderIds.forEach(oldId => {
        const oldFolder = getFolderById(oldId);
        if (!oldFolder) {
            return;
        }
        const newFolder = createFolderData(`${oldFolder.name} Copy`);
        newFolder.parentId = oldFolder.parentId;
        idMap.set(oldId, newFolder.id);
        savedFolders.push(newFolder);
        syncFolderToSupabase(newFolder);
    });

    folderIds.forEach(oldId => {
        const newId = idMap.get(oldId);
        const oldFolder = getFolderById(oldId);
        if (!newId || !oldFolder) {
            return;
        }
        const newFolder = getFolderById(newId);
        if (oldFolder.parentId && idMap.has(oldFolder.parentId)) {
            newFolder.parentId = idMap.get(oldFolder.parentId);
        }
    });

    const invoicesToCopy = savedInvoices.filter(inv => folderIds.includes(inv.folderId));
    invoicesToCopy.forEach(inv => {
        const newInvoice = JSON.parse(JSON.stringify(inv));
        newInvoice.invoiceNumber = getNextInvoiceNumber();
        newInvoice.folderId = idMap.get(inv.folderId) || inv.folderId;
        savedInvoices.push(newInvoice);
        syncInvoiceToSupabase(newInvoice);
    });

    saveFolders();
    saveInvoices();
    renderSavedView();
}

function renameFolder(folderId) {
    const folder = getFolderById(folderId);
    if (!folder) {
        return;
    }
    const name = prompt('New folder name', folder.name || '');
    if (!name) {
        return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
        return;
    }
    folder.name = trimmed;
    syncFolderToSupabase(folder);
    saveFolders();
    renderSavedView();
}

function startManualDrag(element, type, id, startEvent) {
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    dragState = {
        element,
        type,
        id,
        startX,
        startY,
        active: false,
        overElement: null
    };

    const onMove = event => {
        if (!dragState) {
            return;
        }
        const dx = Math.abs(event.clientX - dragState.startX);
        const dy = Math.abs(event.clientY - dragState.startY);
        if (!dragState.active && (dx > 4 || dy > 4)) {
            dragState.active = true;
            dragState.element.classList.add('dragging');
        }
        if (!dragState.active) {
            return;
        }
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const item = target ? target.closest('.saved-item') : null;
        if (dragState.overElement && dragState.overElement !== item) {
            dragState.overElement.classList.remove('drag-over');
        }
        if (item && item !== dragState.element) {
            item.classList.add('drag-over');
            dragState.overElement = item;
        } else {
            dragState.overElement = null;
        }
    };

    const onUp = event => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);

        if (!dragState) {
            return;
        }

        const wasActive = dragState.active;
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const item = target ? target.closest('.saved-item') : null;
        const folderId = item ? item.dataset.folderId : null;
        const invoiceNumber = item ? item.dataset.invoiceNumber : null;

        if (dragState.overElement) {
            dragState.overElement.classList.remove('drag-over');
        }
        dragState.element.classList.remove('dragging');

        if (wasActive) {
            suppressClick = true;
            if (dragState.type === 'folder') {
                if (folderId) {
                    moveFolder(dragState.id, folderId);
                } else {
                    moveFolder(dragState.id, currentSavedFolderId);
                }
            } else if (dragState.type === 'invoice') {
                if (folderId) {
                    moveInvoice(dragState.id, folderId);
                } else if (invoiceNumber) {
                    moveInvoice(dragState.id, currentSavedFolderId, invoiceNumber);
                } else {
                    moveInvoice(dragState.id, currentSavedFolderId);
                }
            }
        }

        dragState = null;
        setTimeout(() => {
            suppressClick = false;
        }, 0);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

initSupabase();
loadStateFromSupabase().then(() => {
    normalizeInvoiceFolders();
    renderSavedView();
});
showHome();
