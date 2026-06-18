// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

// Password protection logic
const CORRECT_CODE = "Caisse974";
const lockScreen = document.getElementById('lockScreen');
const lockForm = document.getElementById('lockForm');
const accessCodeInput = document.getElementById('accessCode');
const lockError = document.getElementById('lockError');
const appContent = document.getElementById('appContent');

if (sessionStorage.getItem('appUnlocked') === 'true') {
    lockScreen.style.display = 'none';
    appContent.style.display = 'flex';
}

lockForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (accessCodeInput.value === CORRECT_CODE) {
        sessionStorage.setItem('appUnlocked', 'true');
        lockScreen.style.display = 'none';
        appContent.style.display = 'flex';
        lockError.style.display = 'none';
    } else {
        lockError.style.display = 'block';
        accessCodeInput.value = '';
        accessCodeInput.focus();
    }
});

// DOM elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const resultsCard = document.getElementById('resultsCard');
const tableBody = document.getElementById('tableBody');
const fileCountSpan = document.getElementById('fileCount');
const clearBtn = document.getElementById('clearBtn');
const exportBtn = document.getElementById('exportBtn');

// State list of processed files data
let extractedData = [];

// Drag and drop event listeners
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
});

dropZone.addEventListener('drop', handleDrop, false);
fileInput.addEventListener('change', handleFileSelect, false);
clearBtn.addEventListener('click', clearAll);
exportBtn.addEventListener('click', exportToExcel);

// Trigger file input click when clicking the drop zone
dropZone.addEventListener('click', () => {
    fileInput.click();
});

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    processFiles(files);
}

function handleFileSelect(e) {
    const files = e.target.files;
    processFiles(files);
}

// Main processor for multiple files
async function processFiles(files) {
    const pdfFiles = Array.from(files).filter(file => file.type === 'application/pdf' || file.name.endsWith('.pdf'));

    if (pdfFiles.length === 0) {
        alert("Veuillez sélectionner ou glisser des fichiers PDF.");
        return;
    }

    for (const file of pdfFiles) {
        try {
            const parsedData = await parsePdf(file);
            // Add a unique ID to each item for state tracking
            parsedData.id = Math.random().toString(36).substring(2, 9);
            extractedData.push(parsedData);
        } catch (error) {
            console.error(`Erreur de lecture sur ${file.name}:`, error);
            alert(`Impossible de lire le fichier ${file.name}.`);
        }
    }

    renderTable();
}

// PDF.js text extractor
function parsePdf(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async function (e) {
            try {
                const arrayBuffer = e.target.result;
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;

                // Read the first page (or page 1)
                const page = await pdf.getPage(1);
                const textContent = await page.getTextContent();
                const items = textContent.items;

                // Group by Y-coordinate with a tolerance of 5px
                const tolerance = 5;
                const linesMap = [];

                for (const item of items) {
                    if (!item.str.trim()) continue;
                    const y = item.transform[5];
                    const x = item.transform[4];

                    let foundLine = linesMap.find(line => Math.abs(line.y - y) <= tolerance);
                    if (!foundLine) {
                        foundLine = { y: y, items: [] };
                        linesMap.push(foundLine);
                    }
                    foundLine.items.push({ x: x, str: item.str });
                }

                // Sort lines from top to bottom (Y descending in PDF coordinate system)
                linesMap.sort((a, b) => b.y - a.y);

                // Sort items inside each line from left to right (X ascending)
                const lines = linesMap.map(line => {
                    line.items.sort((a, b) => a.x - b.x);
                    return line.items.map(item => item.str).join(' ');
                });

                console.log("Extracted lines for file:", file.name, lines);
                // Extract fields
                const dateFin = extractEndDate(lines);
                const magasin = extractStoreName(lines);
                const ttc = extractValueForLabel(lines, ['Total en TTC']);
                const ht = Math.round((ttc / 1.085) * 100) / 100;
                const tva = Math.round((ht * 0.085) * 100) / 100;
                const especes = extractValueForLabel(lines, ['especes', 'espèces']);
                const carte = extractValueForLabel(lines, ['carte', 'cartes', 'cb'], ['cadeau', 'fidelite', 'fidélité']);
                const cheque = extractValueForLabel(lines, ['cheque', 'chèque'], ['cadeau', 'fidelite', 'fidélité']);
                const chequeCadeau = extractValueForLabel(lines, ['cadeau'], ['fidelite', 'fidélité']);
                const avoir = extractValueForLabel(lines, ['avoir', 'avoirs', "bon d'avoir", 'bon d’avoir']);
                const ajuste = extractValueForLabel(lines, ['ajuste', 'ajustement']);

                resolve({
                    fileName: file.name,
                    dateFin,
                    magasin,
                    ttc,
                    ht,
                    tva,
                    especes,
                    carte,
                    cheque,
                    chequeCadeau,
                    avoir,
                    ajuste
                });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

// Map magasin location name to account code
function getAccountForMagasin(magasin) {
    const name = magasin.toUpperCase().trim();
    if (name.includes("CENTRE")) return 70700852;
    if (name.includes("LEU")) return 70700854;
    if (name.includes("SC")) return 70700850;
    if (name.includes("PAUL")) return 70700851;
    if (name.includes("PORTAIL")) return 707000854
    return 70700851; // Fallback to ST PAUL by default
}

// Unified Label Extractor
function extractValueForLabel(lines, keywords, excludeKeywords = []) {
    for (const line of lines) {
        const lower = line.toLowerCase();
        const matchesKeyword = keywords.some(kw => lower.includes(kw.toLowerCase()));
        if (!matchesKeyword) continue;

        const matchesExclude = excludeKeywords.some(ex => lower.includes(ex.toLowerCase()));
        if (matchesExclude) continue;

        const parts = line.split(':');
        if (parts.length > 1) {
            const numStr = parts[1].trim();
            const cleaned = numStr.replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
            if (cleaned) {
                let val = 0;
                if (cleaned.includes(',') && !cleaned.includes('.')) {
                    val = parseFloat(cleaned.replace(',', '.'));
                } else if (cleaned.includes('.') && cleaned.includes(',')) {
                    if (cleaned.indexOf('.') > cleaned.indexOf(',')) {
                        val = parseFloat(cleaned.replace(/,/g, ''));
                    } else {
                        val = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
                    }
                } else {
                    val = parseFloat(cleaned);
                }
                if (!isNaN(val)) return Math.abs(val); // Always return absolute/positive value
            }
        }
    }
    return 0.00;
}

// Field extractors
function extractStoreName(lines) {
    for (const line of lines) {
        const trimmed = line.trim();
        const lower = trimmed.toLowerCase();

        if (trimmed &&
            !trimmed.match(/^\d/) &&
            !lower.includes('du ') &&
            !lower.includes('au ') &&
            !lower.includes('édité') &&
            !lower.includes('edite') &&
            !trimmed.startsWith('-') &&
            trimmed.length > 2) {

            return trimmed.replace(/^[^a-zA-Z0-9À-ÿ]+/, '').trim();
        }
    }
    return "MAGASIN";
}

function extractEndDate(lines) {
    for (const line of lines) {
        const match = line.match(/Au\s+(\d{2}\/\d{2}\/\d{4})/i);
        if (match) {
            return match[1];
        }
    }
    for (const line of lines) {
        const matches = line.match(/(\d{2}\/\d{2}\/\d{4})/g);
        if (matches) {
            return matches[matches.length - 1];
        }
    }
    return new Date().toLocaleDateString('fr-FR');
}

// Rendering function (generates the 7 rows per PDF in the table preview)
function renderTable() {
    if (extractedData.length === 0) {
        resultsCard.style.display = 'none';
        return;
    }

    tableBody.innerHTML = '';
    fileCountSpan.textContent = extractedData.length;
    resultsCard.style.display = 'block';

    extractedData.forEach(item => {
        const accountSales = getAccountForMagasin(item.magasin);

        // Define the 7 rows to insert
        const rowsData = [
            {
                type: 'vente',
                account: `<span class="account-code-${item.id}">${accountSales}</span>`,
                debit: '0.00',
                credit: `<span class="val-ht-${item.id}">${item.ht.toFixed(2)}</span>`,
                label: `
                    <div class="edit-cell-container">
                        <span class="prefix-label">VENTE MSES 8,5% </span>
                        <input type="text" class="magasin-input" value="${item.magasin}" data-id="${item.id}">
                    </div>
                `
            },
            {
                type: 'tva',
                account: '44571',
                debit: '0.00',
                credit: item.tva.toFixed(2),
                label: 'TVA Collectee'
            },
            {
                type: 'especes',
                account: '5812',
                debit: item.especes.toFixed(2),
                credit: '0.00',
                label: 'VERST ESPECES'
            },
            {
                type: 'cheques',
                account: '5814',
                debit: item.cheque.toFixed(2),
                credit: '0.00',
                label: 'REMISE CHEQUES'
            },
            {
                type: 'cheques_cadeaux',
                account: '5814',
                debit: item.chequeCadeau.toFixed(2),
                credit: '0.00',
                label: 'REMISE CHEQUES CADEAUX'
            },
            {
                type: 'cb',
                account: '581001',
                debit: item.carte.toFixed(2),
                credit: '0.00',
                label: 'REMISE CB'
            },
            {
                type: 'avoir',
                account: '471',
                debit: item.avoir.toFixed(2),
                credit: '0.00',
                label: 'BON D AVOIR'
            },
            {
                type: 'ajuste',
                account: '471',
                debit: '0.00',
                credit: item.ajuste.toFixed(2),
                label: 'REST AJUSTE'
            }
        ];

        rowsData.forEach(rowData => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.dateFin}</td>
                <td>CA</td>
                <td>${rowData.account}</td>
                <td class="amount-val debit">${rowData.debit}</td>
                <td class="amount-val credit">${rowData.credit}</td>
                <td>${rowData.label}</td>
                <td><span class="source-badge" title="${item.fileName}">${item.fileName}</span></td>
            `;
            tableBody.appendChild(tr);
        });
    });

    // Add event listeners to the store input fields
    document.querySelectorAll('.magasin-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const id = e.target.getAttribute('data-id');
            const val = e.target.value;
            const found = extractedData.find(item => item.id === id);
            if (found) {
                found.magasin = val;

                // Dynamically update corresponding UI elements in other cells without redrawing/losing focus
                const accountVal = getAccountForMagasin(val);
                const accountSpan = document.querySelector(`.account-code-${id}`);
                if (accountSpan) {
                    accountSpan.textContent = accountVal;
                }
            }
        });
    });
}

function clearAll() {
    extractedData = [];
    renderTable();
    fileInput.value = '';
}

// Excel generation via SheetJS
function exportToExcel() {
    if (extractedData.length === 0) return;

    const data = [];

    extractedData.forEach((item) => {
        const accountSales = getAccountForMagasin(item.magasin);

        // 1. Sales row (HT Credit)
        data.push([
            item.dateFin,
            "CA",
            accountSales,
            0,
            item.ht,
            `VENTE MSES 8,5% ${item.magasin}`
        ]);

        // 2. VAT row (TVA Credit)
        data.push([
            item.dateFin,
            "CA",
            44571,
            0,
            item.tva,
            "TVA Collectee"
        ]);

        // 3. Especes row (Debit)
        data.push([
            item.dateFin,
            "CA",
            5812,
            item.especes,
            0,
            "VERST ESPECES"
        ]);

        // 4. Cheques row (Debit)
        data.push([
            item.dateFin,
            "CA",
            5814,
            item.cheque,
            0,
            "REMISE CHEQUES"
        ]);

        // 4b. Cheques Cadeaux row (Debit)
        data.push([
            item.dateFin,
            "CA",
            5814,
            item.chequeCadeau,
            0,
            "REMISE CHEQUES CADEAUX"
        ]);

        // 5. Carte/CB row (Debit)
        data.push([
            item.dateFin,
            "CA",
            581001,
            item.carte,
            0,
            "REMISE CB"
        ]);

        // 6. Avoir row (Debit)
        data.push([
            item.dateFin,
            "CA",
            471,
            item.avoir,
            0,
            "BON D AVOIR"
        ]);

        // 7. Rest Ajuste row (Credit)
        data.push([
            item.dateFin,
            "CA",
            471,
            0,
            item.ajuste,
            "REST AJUSTE"
        ]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(data);

    // Format Debit (col D, index 3) and Credit (col E, index 4) cells as numbers with 2 decimals
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
        const cellRefD = XLSX.utils.encode_cell({ r: r, c: 3 });
        const cellD = worksheet[cellRefD];
        if (cellD) {
            cellD.z = '0.00';
        }

        const cellRefE = XLSX.utils.encode_cell({ r: r, c: 4 });
        const cellE = worksheet[cellRefE];
        if (cellE) {
            cellE.z = '0.00';
        }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Écritures Comptables");

    XLSX.writeFile(workbook, `ecritures_caisse_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
