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
        reader.onload = async function(e) {
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
                const ttc = extractTotalTTC(lines);
                const tva = Math.round(ttc * 0.085 * 100) / 100;

                resolve({
                    fileName: file.name,
                    dateFin,
                    magasin,
                    ttc,
                    tva
                });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

// Field extractors
function extractStoreName(lines) {
    // Universal extraction: get the first clean text line of the document
    // excluding date-related or metadata keywords.
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
            
            // Remove any leading punctuation/spaces and return
            return trimmed.replace(/^[^a-zA-Z0-9À-ÿ]+/, '').trim();
        }
    }
    return "MAGASIN"; // Default fallback
}

function extractEndDate(lines) {
    for (const line of lines) {
        const match = line.match(/Au\s+(\d{2}\/\d{2}\/\d{4})/i);
        if (match) {
            return match[1];
        }
    }
    // Fallback search for any date
    for (const line of lines) {
        const matches = line.match(/(\d{2}\/\d{2}\/\d{4})/g);
        if (matches) {
            return matches[matches.length - 1]; // Use last date found
        }
    }
    return new Date().toLocaleDateString('fr-FR');
}

function extractTotalTTC(lines) {
    for (const line of lines) {
        if (line.toLowerCase().includes('total en ttc')) {
            const parts = line.split(':');
            if (parts.length > 1) {
                const numStr = parts[1].trim();
                const cleaned = numStr
                    .replace(/\s/g, '') // Remove spaces
                    .replace(/[^0-9,.-]/g, ''); // Filter numbers and symbols
                
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
                    if (!isNaN(val)) return val;
                }
            }
        }
    }
    return 0.00; // Returns 0 if redacted or not found
}

// Rendering function
function renderTable() {
    if (extractedData.length === 0) {
        resultsCard.style.display = 'none';
        return;
    }

    tableBody.innerHTML = '';
    fileCountSpan.textContent = extractedData.length;
    resultsCard.style.display = 'block';

    extractedData.forEach(item => {
        // Row 1: Sales (Ventes)
        const rowVentes = document.createElement('tr');
        rowVentes.innerHTML = `
            <td>${item.dateFin}</td>
            <td>CA</td>
            <td>70700852</td>
            <td>0</td>
            <td class="amount-val ttc">${item.ttc.toFixed(2)}</td>
            <td>
                <div class="edit-cell-container">
                    <span class="prefix-label">VENTES MSES 8,50% </span>
                    <input type="text" class="magasin-input" value="${item.magasin}" data-id="${item.id}">
                </div>
            </td>
            <td><span class="source-badge" title="${item.fileName}">${item.fileName}</span></td>
        `;
        tableBody.appendChild(rowVentes);

        // Row 2: VAT (TVA)
        const rowTva = document.createElement('tr');
        rowTva.innerHTML = `
            <td>${item.dateFin}</td>
            <td>CA</td>
            <td>44571000</td>
            <td>0</td>
            <td class="amount-val tva">${item.tva.toFixed(2)}</td>
            <td>TVA COLLECTEE</td>
            <td><span class="source-badge" title="${item.fileName}">${item.fileName}</span></td>
        `;
        tableBody.appendChild(rowTva);
    });

    // Add event listeners to the inputs to dynamically update state on change
    document.querySelectorAll('.magasin-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const id = e.target.getAttribute('data-id');
            const val = e.target.value;
            const found = extractedData.find(item => item.id === id);
            if (found) {
                found.magasin = val;
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

    // Create custom worksheet data structure
    const data = [];

    extractedData.forEach((item, index) => {
        const rowIdx = (index * 2) + 1; // 1-based index in Excel rows

        // Sales row
        data.push([
            item.dateFin,
            "CA",
            70700852,
            0,
            item.ttc,
            `VENTES MSES 8,50% ${item.magasin}`
        ]);

        // VAT row using Excel formula `=E{rowIdx}*0.085` and fallback value
        data.push([
            item.dateFin,
            "CA",
            44571000,
            0,
            { f: `E${rowIdx}*0.085`, v: item.tva },
            "TVA COLLECTEE"
        ]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(data);

    // Set formatting for column E (amount) to decimal numbers
    // Let's iterate over cells in column E (index 4)
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
        const cellRef = XLSX.utils.encode_cell({ r: r, c: 4 });
        const cell = worksheet[cellRef];
        if (cell) {
            cell.z = '0.00'; // Numeric format with 2 decimals
        }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Écritures Comptables");

    // Generate Excel file and trigger download
    XLSX.writeFile(workbook, `ecritures_caisse_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
