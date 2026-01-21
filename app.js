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
let supabaseClient = null;
let supabaseSyncTimer = null;

const SUPABASE_URL = 'https://rqnmaoqzdwnuaiwrutte.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxbm1hb3F6ZHdudWFpd3J1dHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5ODE1MzAsImV4cCI6MjA4NDU1NzUzMH0.ZE77nGj5-4zCSDwmAh5exlnQ_NcVxGniDVua_qLA0Fs';
const WORKSPACE_ID = 'default';

function saveFolders() {
    localStorage.setItem('invoiceFolders', JSON.stringify(savedFolders));
    scheduleSupabaseSync();
}

function saveInvoices() {
    localStorage.setItem('invoices', JSON.stringify(savedInvoices));
    scheduleSupabaseSync();
}

function saveDeleteHistory() {
    localStorage.setItem('invoiceDeleteHistory', JSON.stringify(deleteHistory));
    scheduleSupabaseSync();
}
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

function getDefaultMetaFields() {
    return [
        { key: 'invoiceNumber', label: '#', type: 'text', value: '0454', required: true },
        { key: 'invoiceDate', label: 'DATE:', type: 'date', value: defaultDate, required: true },
        { key: 'projectCode', label: 'PROJECT', type: 'text', value: '', required: false },
        { key: 'supervisor', label: 'Supervisor', type: 'text', value: '', required: false }
    ];
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

    const tax = 0; // Can be modified for tax calculation
    const total = subtotal + tax;

    document.getElementById('subtotal').textContent = '$' + subtotal.toFixed(2);
    document.getElementById('tax').textContent = '$' + tax.toFixed(2);
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
        items: items,
        metaFields: metaFields
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
    
    saveInvoices();
    
    alert('Invoice saved successfully!');
    renderSavedInvoices();
}

function loadInvoice(data) {
    lastOpenedFolderId = data.folderId ? String(data.folderId) : null;
    currentFolderId = data.folderId || ensureDefaultFolder();
    const fields = data.metaFields && data.metaFields.length
        ? data.metaFields
        : getDefaultMetaFields().map(field => ({
            ...field,
            value: field.key === 'invoiceNumber'
                ? data.invoiceNumber
                : field.key === 'invoiceDate'
                ? data.date
                : field.key === 'projectCode'
                ? data.project
                : field.key === 'supervisor'
                ? data.supervisor
                : field.value
        }));
    renderMetaFields(fields);
    document.getElementById('fromCompany').value = data.from;
    document.getElementById('billToCompany').value = data.billTo;
    document.getElementById('billToAddress').value = data.billToAddress;
    
    // Clear existing items
    document.getElementById('itemsBody').innerHTML = '';
    
    // Add items
    data.items.forEach(item => addItem(item));
}

function createNewInvoice() {
    if (confirm('Create a new invoice? Any unsaved changes will be lost.')) {
        // Generate new invoice number
        const newNumber = (parseInt(getMetaFieldsFromDOM().find(field => field.key === 'invoiceNumber')?.value || '0', 10) + 1).toString().padStart(4, '0');
        
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
        
        // Clear items
        document.getElementById('itemsBody').innerHTML = '';
        
        // Add one empty item
        addItem();
        showEditor();
    }
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
            } else {
                input.setAttribute('value', original.value || '');
            }
            input.removeAttribute('placeholder');
        });
        containerHtml = cloned.outerHTML;
    }
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Invoice</title>
    <style>${cssText}</style>
</head>
<body>
${containerHtml}
</body>
</html>`;

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
    const newNumber = (parseInt(getMetaFieldsFromDOM().find(field => field.key === 'invoiceNumber')?.value || '0', 10) + 1).toString().padStart(4, '0');
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
    document.getElementById('itemsBody').innerHTML = '';
    addItem();
    showEditor();
}

function startNewInvoiceInSavedFolder() {
    const targetFolderId = currentSavedFolderId || ensureDefaultFolder();
    currentFolderId = targetFolderId;
    lastOpenedFolderId = targetFolderId;
    const newNumber = (parseInt(getMetaFieldsFromDOM().find(field => field.key === 'invoiceNumber')?.value || '0', 10) + 1).toString().padStart(4, '0');
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
    saveInvoices();
    renderSavedView();
}

// Initialize with some sample items from the screenshot
addItem({description: 'A-001 STRAND', quantity: 0, rate: 0.67});
addItem({description: 'A-007 Place Anchor', quantity: 1, rate: 150});
addItem({description: 'A-010 Place Make Ready', quantity: 0, rate: 39});
addItem({description: 'U-001 Composite Underground Bore with Conduit Placement', quantity: 699, rate: 11.5});
addItem({description: 'U-001C Conduit Adder in same bore', quantity: 251, rate: 0.5});
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

    if (!foldersHere.length && !invoicesHere.length) {
        const empty = document.createElement('div');
        empty.className = 'invoice-empty';
        empty.textContent = 'No items here yet.';
        list.appendChild(empty);
        return;
    }

    foldersHere.forEach(folder => {
        const item = document.createElement('div');
        item.className = 'saved-item';
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

        const title = document.createElement('div');
        title.className = 'saved-item-title';
        title.textContent = folder.name;

        const meta = document.createElement('div');
        meta.className = 'saved-item-meta';
        const count = savedInvoices.filter(inv => inv.folderId === folder.id).length;
        meta.textContent = `${count} invoice${count === 1 ? '' : 's'}`;

        const actions = document.createElement('div');
        actions.className = 'saved-item-actions';

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

        actions.appendChild(duplicateBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(title);
        item.appendChild(meta);
        item.appendChild(actions);
        list.appendChild(item);
    });

    invoicesHere.forEach(invoice => {
        const item = document.createElement('div');
        item.className = 'saved-item';
        item.dataset.invoiceNumber = invoice.invoiceNumber;
        item.onclick = () => {
            if (suppressClick) {
                suppressClick = false;
                return;
            }
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

        const title = document.createElement('div');
        title.className = 'saved-item-title';
        const projectName = invoice.project || 'No project';
        const invoiceNumber = invoice.invoiceNumber || '';
        title.textContent = `Project: ${projectName} -- Invoice #: ${invoiceNumber}`;

        const meta = document.createElement('div');
        meta.className = 'saved-item-meta';
        const project = document.createElement('span');
        project.textContent = invoice.project || 'No project';
        const date = document.createElement('span');
        date.textContent = invoice.date || '';
        meta.appendChild(project);
        meta.appendChild(date);

        const actions = document.createElement('div');
        actions.className = 'saved-item-actions';

        const duplicateBtn = document.createElement('button');
        duplicateBtn.textContent = 'Duplicate';
        duplicateBtn.onclick = event => {
            event.stopPropagation();
            duplicateInvoice(invoice.invoiceNumber);
        };

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = event => {
            event.stopPropagation();
            deleteInvoice(invoice.invoiceNumber);
        };

        actions.appendChild(duplicateBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(title);
        item.appendChild(meta);
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
        message.textContent = 'Invoice deleted.';
    } else {
        message.textContent = 'Folder deleted.';
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

function getStateSnapshot() {
    return {
        invoices: savedInvoices,
        folders: savedFolders,
        deleteHistory: deleteHistory
    };
}

function scheduleSupabaseSync() {
    if (!supabaseClient) {
        return;
    }
    if (supabaseSyncTimer) {
        clearTimeout(supabaseSyncTimer);
    }
    supabaseSyncTimer = setTimeout(() => {
        persistStateToSupabase();
    }, 400);
}

async function persistStateToSupabase() {
    if (!supabaseClient) {
        return;
    }
    const state = getStateSnapshot();
    try {
        await supabaseClient
            .from('invoice_state')
            .upsert(
                {
                    workspace_id: WORKSPACE_ID,
                    state: state,
                    updated_at: new Date().toISOString()
                },
                { onConflict: 'workspace_id' }
            );
    } catch (error) {
        // Keep localStorage as fallback if remote save fails.
    }
}

async function loadStateFromSupabase() {
    if (!supabaseClient) {
        return;
    }
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
        }
    } catch (error) {
        // Ignore fetch errors; localStorage remains the source.
    }
}

function deleteInvoice(invoiceNumber) {
    const invoice = savedInvoices.find(inv => inv.invoiceNumber === invoiceNumber);
    if (!invoice) {
        return;
    }
    setUndoSnapshot({
        type: 'invoice',
        invoices: [invoice],
        folders: []
    });
    savedInvoices = savedInvoices.filter(inv => inv.invoiceNumber !== invoiceNumber);
    saveInvoices();
    renderSavedView();
}

function duplicateInvoice(invoiceNumber) {
    const invoice = savedInvoices.find(inv => inv.invoiceNumber === invoiceNumber);
    if (!invoice) {
        return;
    }
    const copy = { ...invoice, invoiceNumber: getNextInvoiceNumber() };
    savedInvoices.push(copy);
    saveInvoices();
    renderSavedView();
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
        folders: deletedFolders,
        invoices: deletedInvoices
    });
    savedFolders = savedFolders.filter(f => !folderIdSet.has(String(f.id)));
    savedInvoices = savedInvoices.filter(inv => !folderIdSet.has(String(inv.folderId)));
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
        const newInvoice = { ...inv };
        newInvoice.invoiceNumber = getNextInvoiceNumber();
        newInvoice.folderId = idMap.get(inv.folderId) || inv.folderId;
        savedInvoices.push(newInvoice);
    });

    saveFolders();
    saveInvoices();
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
