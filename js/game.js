'use strict';

let isGameMode = false;
let currentGameRound = 1; // Maksimal 4 sekarang
let gameTimeouts = []; // Array untuk menampung ID setTimeout
let gameClusterLayer = null; // Layer khusus 10 marker game
let gameScore = 0;

// Data soal & pilihan
let targetGameData = null;
let poolGameData = []; // 10 data terpilih untuk map
let usedGameQIDs = new Set(); // Mencegah QID jadi target di ronde berikutnya

// State pemulihan UI Filter
let savedFilterState = {};

// Referensi DOM (Pastikan HTML memiliki ID ini)
const btnMulaiGame = document.getElementById('btn-mulai-game');
const navBeranda = document.getElementById('nav-beranda');
const navHasil = document.getElementById('nav-hasil-container');
const btnMenuInduk = document.getElementById('btn-menu-induk'); 
const gameDialog = document.getElementById('game-dialog');
const gameMessage = document.getElementById('game-message');
const gameOverlay = document.getElementById('game-overlay');

function getGamePrefix() {
    let prefix = 'letak';
    if (['Kabupaten dan kota'].includes(currentNamaKlaster)) prefix = 'provinsi';
    else if (['Tempat lahir tokoh'].includes(currentNamaKlaster)) prefix = 'tempat lahir';
    else if (['Latar karya sastra'].includes(currentNamaKlaster)) prefix = 'latar';
    else if (['Publikasi', 'Media massa'].includes(currentNamaKlaster)) prefix = 'tempat terbit';
    else if (['Lukisan', 'Lontar', 'Naskah'].includes(currentNamaKlaster)) prefix = 'koleksi';
    else if (['Gempa bumi dan tsunami', 'Peristiwa lainnya', 'Perang & konflik', 'Bencana lainnya'].includes(currentNamaKlaster)) prefix = 'pusat kejadian/terdampak';
    else if (['Situs arkeologi lainnya'].includes(currentNamaKlaster)) prefix = 'letak';
    else if (['Prasasti', 'Artefak'].includes(currentNamaKlaster)) prefix = 'lokasi sekarang';

    if (currentKategoriUtama === 'alam') {
        if (['Bahasa'].includes(currentNamaKlaster)) prefix = 'wilayah penutur utama';
        else if (['Hidangan', 'Pakaian', 'Tari dan pertunjukan', 'Ritual dan upacara', 'Budaya rakyat'].includes(currentNamaKlaster)) prefix = `${currentNamaKlaster.toLowerCase()} khas`;
    }
    return prefix;
}


// ==========================================
// 2. TOMBOL MULAI, BATAL & SKIP
// ==========================================
btnMulaiGame.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();

    let validRecords = Object.values(Records).filter(r => r.lat && r.lon && r.imageFilename);
    let uniqueRegions = new Set();
    validRecords.forEach(r => {
        let provArray = Object.keys(r.designations).filter(p => p !== 'all' && ProvinceIndex[p] && ProvinceIndex[p].name !== 'Wilayah Lainnya/Tidak Spesifik');
        provArray.forEach(p => uniqueRegions.add(p));
    });

    if (validRecords.length < 10 || uniqueRegions.size < 4) {
        tampilkanDialog("Pencarian saat ini belum memenuhi syarat Mode Game.<br><br>Pastikan ada <b>minimal 10 data bergambar</b> yang tersebar di <b>minimal 4 wilayah/provinsi berbeda</b>.", "alert", "Syarat Belum Terpenuhi");
        return;
    }

    savedFilterState = {
        region: currentRegionFilter,
        usia: currentUsiaFilter,
        sort: currentUsiaSort,
        search: currentSearchQuery,
        features: Array.from(activeFeatures),
        isAllActive: document.getElementById('btn-all') ? document.getElementById('btn-all').classList.contains('active') : false
    };

    isGameMode = true;
    currentGameRound = 1;
    gameScore = 0;
    usedGameQIDs.clear();
    clearAllGameTimeouts();

    if (typeof window.setMobilePanelExpanded === 'function') {
        window.setMobilePanelExpanded(false, false);
    }
    
    const elemenDikunci = ['panel', 'branding', 'panel-handle'];
    elemenDikunci.forEach(id => {
        let el = document.getElementById(id);
        if (el) el.classList.add('terkunci-game');
    });
    
    navHasil.classList.add('nav-disabled');
    navBeranda.textContent = "Akhiri"; 
    navBeranda.classList.add('text-danger'); 
    navBeranda.setAttribute('href', 'javascript:void(0)');

    btnMenuInduk.textContent = "Lewati";
    btnMenuInduk.classList.add('text-primary');
    document.getElementById('submenu-atas').classList.add('d-none');

    Cluster.clearLayers();
    if (Map) Map.closePopup();
    
    jalankanRonde();
});

navBeranda.addEventListener('click', function(e) {
    if (isGameMode) {
        e.preventDefault(); 
        akhiriGameMode();
    }
});

btnMenuInduk.addEventListener('click', function(e) {
    if (isGameMode) {
        e.preventDefault();
        e.stopPropagation();
        
        clearAllGameTimeouts();
        
        // Cek jika sedang puzzle, tutup manual overlaynya
        if (document.getElementById('puzzle-overlay')) tutupPuzzle(false, true);

        currentGameRound++;
        if (currentGameRound > 4) { // Berubah dari 3 menjadi 4
            akhiriGameMode(true); 
        } else {
            jalankanRonde();
        }
    }
});

// ==========================================
// 3. LOGIKA RONDE GAME
// ==========================================
function jalankanRonde() {
    clearAllGameTimeouts();
    if (Map) Map.closePopup();
    if (gameClusterLayer) {
        Map.removeLayer(gameClusterLayer);
        gameClusterLayer = null;
    }
    
    const panelMobile = document.getElementById('panel');
    if (panelMobile) panelMobile.classList.add('terkunci-game');

    gameDialog.classList.remove('d-none');
    gameOverlay.classList.remove('lock-screen', 'd-none');
    
    if (currentGameRound === 1) {
        gameOverlay.classList.add('ronde-1');
        gameOverlay.classList.remove('ronde-lanjut');
    } else {
        gameOverlay.classList.add('ronde-lanjut');
        gameOverlay.classList.remove('ronde-1');
    }
    
    document.getElementById('game-title').textContent = `Tantangan ${currentGameRound}/4`; // Berubah ke 4
    gameDialog.style.border = "none";

    gameClusterLayer = L.markerClusterGroup({
        maxClusterRadius: 40,
        spiderfyOnMaxZoom: false,
        zoomToBoundsOnClick: false
    });

    gameClusterLayer.on('clusterclick', function (a) {
        if (currentGameRound !== 1) return; 

        let cluster = a.layer;
        let bounds = cluster.getBounds();
        let isSamePoint = bounds.getSouthWest().equals(bounds.getNorthEast());
        
        let currentZoom = Map.getZoom();
        let maxZoom = Map.getMaxZoom();

        if (isSamePoint || currentZoom >= maxZoom) {
            let anakKluster = cluster.getAllChildMarkers();
            let targetDitemukan = false;

            for (let i = 0; i < anakKluster.length; i++) {
                if (anakKluster[i] === targetGameData.mapMarkerGame) {
                    targetDitemukan = true;
                    break;
                }
            }

            if (targetDitemukan) {
                evaluasiJawabanGame(true, targetGameData.title, targetGameData.id, targetGameData.mapMarkerGame);
            } else {
                evaluasiJawabanGame(false, "Area Titik Bertumpuk", null, targetGameData.mapMarkerGame);
            }
        } 
        else {
            Map.fitBounds(bounds, { padding: [30, 30], maxZoom: maxZoom });
        }
    });

    let allValid = Object.values(Records).filter(r => r.lat && r.lon && r.imageFilename);
    let availableForTarget = allValid.filter(r => !usedGameQIDs.has(r.id));
    
    targetGameData = availableForTarget[Math.floor(Math.random() * availableForTarget.length)];
    usedGameQIDs.add(targetGameData.id);

    let distractorPool = allValid.filter(r => r.id !== targetGameData.id);
    let shuffledDistractors = distractorPool.sort(() => 0.5 - Math.random()).slice(0, 9);
    
    poolGameData = [targetGameData, ...shuffledDistractors];
    
    // Alur Ronde 1 - 4
    if (currentGameRound === 1) setupGame1();
    else if (currentGameRound === 2) setupGame2();
    else if (currentGameRound === 3) setupGame3();
    else if (currentGameRound === 4) setupGame4(); // Panggil Ronde 4 (Puzzle)

    Map.addLayer(gameClusterLayer);
    
    if (currentGameRound === 1) {
        let groupBounds = L.featureGroup(gameClusterLayer.getLayers()).getBounds();
        Map.flyToBounds(groupBounds, { duration: 1.5, padding: [30, 30] });
    } else if (currentGameRound <= 3) {
        Map.fitBounds([
            [MAX_PH_LAT, MAX_PH_LON], 
            [MIN_PH_LAT, MIN_PH_LON]
        ], { duration: 1.5, padding: [20, 20] });
    }
}

// ------------------------------------------
// GAME 1 - 3 (Logic Tidak Berubah)
// ------------------------------------------
function setupGame1() {
    let prefix = getGamePrefix();
    let kataTanya = (prefix === 'letak' || prefix === 'lokasi sekarang') ? 'lokasi' : prefix;
    gameMessage.innerHTML = `Temukan di peta ${kataTanya}:<br><strong style="color:#d9534f;">${targetGameData.title}</strong>?`;
    poolGameData.forEach(record => {
        let marker = L.marker([record.lat, record.lon], { icon: ikonTetesanAir });
        record.mapMarkerGame = marker; 
        marker.on('click', function() {
            let isBenar = (record.id === targetGameData.id);
            evaluasiJawabanGame(isBenar, record.title, record.id, marker);
        });
        gameClusterLayer.addLayer(marker);
    });
}

function setupGame2() {
    gameMessage.innerHTML = `Manakah yang menggambarkan/foto dari:<br><strong style="color:#d9534f;">${targetGameData.title}</strong>?`;
    let opsiBenar = { id: targetGameData.id, title: targetGameData.title, image: targetGameData.imageFilename, benar: true };
    let allValidPhotoRecords = Object.values(Records).filter(r => r.lat && r.lon && r.imageFilename && r.id !== targetGameData.id);
    let distractors = allValidPhotoRecords.sort(() => 0.5 - Math.random()).slice(0, 3).map(r => ({
        id: r.id, title: r.title, image: r.imageFilename, benar: false
    }));
    let options = [opsiBenar, ...distractors].sort(() => 0.5 - Math.random());
    let markerRahasia = L.marker([targetGameData.lat, targetGameData.lon], { icon: ikonTetesanAir });
    renderPilihanGandaGambar(options, markerRahasia);
}

function renderPilihanGandaGambar(options, markerTargetAsli) {
    let htmlTombol = `<div class="game-options-grid-img mt-15" style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px;">`;
    options.forEach((opt) => {
        let imgUrl = `${COMMONS_WIKI_URL_PREF}Special:FilePath/${encodeURIComponent(opt.image)}?width=250`;
        htmlTombol += `
            <button class="btn-game-option-img" data-benar="${opt.benar}" data-title="${opt.title.replace(/"/g, '&quot;')}" 
                    style="padding:0; border:3px solid #ddd; background:#fff; border-radius:8px; cursor:pointer; overflow:hidden; width:100%; height:110px; display:flex; align-items:center; justify-content:center; transition:all 0.2s ease;">
                <img src="${imgUrl}" style="width:100%; height:100%; object-fit:cover; display:block;" alt="Pilihan Gambar">
            </button>`;
    });
    htmlTombol += `</div>`;
    gameMessage.insertAdjacentHTML('beforeend', htmlTombol);

    let buttons = gameMessage.querySelectorAll('.btn-game-option-img');
    buttons.forEach(btn => {
        btn.addEventListener('click', function() {
            let isBenar = this.getAttribute('data-benar') === 'true';
            buttons.forEach(b => { b.disabled = true; b.style.cursor = 'default'; });
            if (!isBenar) {
                this.style.borderColor = "#d9534f"; 
                this.style.boxShadow = "0 0 8px rgba(217, 83, 79, 0.5)";
                let btnBenar = gameMessage.querySelector('.btn-game-option-img[data-benar="true"]');
                if(btnBenar) { btnBenar.style.borderColor = "#5cb85c"; btnBenar.style.boxShadow = "0 0 8px rgba(92, 184, 92, 0.5)"; }
            } else {
                this.style.borderColor = "#5cb85c"; this.style.boxShadow = "0 0 8px rgba(92, 184, 92, 0.5)";
            }
            evaluasiJawabanGame(isBenar, this.getAttribute('data-title'), targetGameData.id, markerTargetAsli);
        });
        btn.addEventListener('mouseover', function() { if (!this.disabled) this.style.borderColor = "#337ab7"; });
        btn.addEventListener('mouseout', function() { if (!this.disabled) this.style.borderColor = "#ddd"; });
    });
}

function setupGame3() {
    let imgUrl = `${COMMONS_WIKI_URL_PREF}Special:FilePath/${encodeURIComponent(targetGameData.imageFilename)}?width=500`;
    let tanyaNama = `Apa nama ${currentNamaKlaster.toLowerCase()} ini?`;
    if (currentNamaKlaster === 'Tempat lahir tokoh') tanyaNama = `Siapa nama tokoh ini?`;

    gameMessage.innerHTML = `${tanyaNama}<br><img src="${imgUrl}" style="width:100%; max-height:180px; object-fit:cover; border-radius:8px; margin-top:10px; cursor:pointer;" title="Klik untuk memperbesar">`;

    let provIdsBenar = Object.keys(targetGameData.designations).filter(p => p !== 'all' && ProvinceIndex[p]);
    let provTarget = provIdsBenar.length > 0 ? provIdsBenar[0] : null;
    let distractorPool = provTarget ? Object.values(Records).filter(r => r.id !== targetGameData.id && r.areaTags.has(provTarget)) : [];
    
    if (distractorPool.length < 3) {
        let sisanya = Object.values(Records).filter(r => r.id !== targetGameData.id && !distractorPool.includes(r));
        distractorPool = distractorPool.concat(sisanya.sort(() => 0.5 - Math.random()).slice(0, 3 - distractorPool.length));
    }

    let distractors = distractorPool.sort(() => 0.5 - Math.random()).slice(0, 3);
    let options = [{ nama: targetGameData.title, benar: true }, ...distractors.map(d => ({ nama: d.title, benar: false }))].sort(() => 0.5 - Math.random());

    let markerRahasia = L.marker([targetGameData.lat, targetGameData.lon], { icon: ikonTetesanAir });
    renderTombolPilihanGanda(options, markerRahasia);
}

function renderTombolPilihanGanda(options, markerTargetAsli) {
    let htmlTombol = `<div class="game-options-grid mt-10" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">`;
    options.forEach((opt) => {
        htmlTombol += `<button class="btn-game-option" data-benar="${opt.benar}" data-nama="${opt.nama}" style="padding:10px; border:2px solid #ccc; background:#f9f9f9; border-radius:5px; cursor:pointer; transition:all 0.2s ease;">${opt.nama}</button>`;
    });
    htmlTombol += `</div>`;
    gameMessage.insertAdjacentHTML('beforeend', htmlTombol);

    let buttons = gameMessage.querySelectorAll('.btn-game-option');
    buttons.forEach(btn => {
        btn.addEventListener('click', function() {
            let isBenar = this.getAttribute('data-benar') === 'true';
            buttons.forEach(b => { b.disabled = true; b.style.cursor = 'default'; });
            
            if (!isBenar) {
                this.style.background = "#ffcccc"; this.style.borderColor = "red";
                let btnBenar = gameMessage.querySelector('.btn-game-option[data-benar="true"]');
                if(btnBenar) { btnBenar.style.background = "#ccffcc"; btnBenar.style.borderColor = "green"; }
            } else {
                this.style.background = "#ccffcc"; this.style.borderColor = "green";
            }
            evaluasiJawabanGame(isBenar, this.getAttribute('data-nama'), targetGameData.id, markerTargetAsli);
        });
        btn.addEventListener('mouseover', function() {
            if (!this.disabled) { this.style.borderColor = "#337ab7"; this.style.background = "#e6f0f9"; }
        });
        btn.addEventListener('mouseout', function() {
            if (!this.disabled) { this.style.borderColor = "#ccc"; this.style.background = "#f9f9f9"; }
        });
    });
}

function evaluasiJawabanGame(isBenar, titleDiklik, qidDiklik, markerSistem) {
    if (isBenar) gameScore++; 
    gameOverlay.classList.add('lock-screen');
    document.getElementById('game-title').textContent = isBenar ? "Tepat Sekali! 🎉" : "Sayang Sekali ❌";
    
    if (currentGameRound === 1) {
        if (isBenar) gameMessage.innerHTML = `Anda berhasil menemukan <strong>${targetGameData.title}</strong>!`;
        else gameMessage.innerHTML = `Anda memilih <strong>${titleDiklik}</strong>.<br>Mengarahkan ke lokasi yang benar...`;
    } 
    else if (currentGameRound === 2 || currentGameRound === 3) {
        if (isBenar) gameMessage.innerHTML = `Tepat sekali! Kamu memilih <strong>${targetGameData.title}</strong>.`;
        else gameMessage.innerHTML = `Sayang sekali, jawabanmu adalah <strong>${titleDiklik}</strong>.<br>Mengarahkan ke lokasi ${targetGameData.title}...`;
    }

    gameDialog.style.border = isBenar ? "3px solid green" : "3px solid red";

    if (markerSistem && !gameClusterLayer.hasLayer(markerSistem)) {
        gameClusterLayer.addLayer(markerSistem);
    }
    
    let durasiTerbang = isBenar ? 1.5 : 2.5;
    let waktuTungguBukaPopup = isBenar ? 1700 : 2700;

    Map.flyTo([targetGameData.lat, targetGameData.lon], 17, { duration: durasiTerbang });

    let t1 = setTimeout(() => {
        bukaPanelEksklusif(targetGameData.id);
        
        let parent = gameClusterLayer ? gameClusterLayer.getVisibleParent(markerSistem) : null;
        if (!parent || !parent.spiderfy) {
            if (markerSistem) markerSistem.openPopup();
        }

        let t2 = setTimeout(() => {
            if (Map) Map.closePopup();
            tutupPanelEksklusif();
            
            currentGameRound++;
            if (currentGameRound > 4) akhiriGameMode(true); // Berubah ke 4
            else jalankanRonde();

        }, 5000);
        gameTimeouts.push(t2);

    }, waktuTungguBukaPopup);

    gameTimeouts.push(t1);
}


// ==========================================
// 4. GAME 4 (RESTORASI ARSIP - PUZZLE GRID)
// ==========================================

function injectPuzzleCSS() {
    if (document.getElementById('puzzle-style-injected')) return;
    const style = document.createElement('style');
    style.id = 'puzzle-style-injected';
    style.innerHTML = `
        #puzzle-overlay {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.85);
            z-index: 99999; /* Glass Shield di atas Leaflet */
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            backdrop-filter: blur(5px);
            opacity: 0; transition: opacity 0.5s ease;
        }
        #puzzle-overlay.show { opacity: 1; }
        #puzzle-title {
            color: white; font-size: 1.3rem; margin-bottom: 15px; text-shadow: 1px 1px 3px #000;
            text-align: center; font-weight: bold; padding: 0 15px;
        }
        #puzzle-board {
            display: grid; gap: 2px;
            background: #222; border: 4px solid #fff; border-radius: 8px; padding: 2px;
            transition: gap 0.5s ease, border-color 0.5s ease;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
margin: 0 auto; /* Memastikan posisi di tengah */
        }
        #puzzle-board.solved {
            gap: 0px !important; border-color: #5cb85c;
            box-shadow: 0 10px 30px rgba(92, 184, 92, 0.8); pointer-events: none;
        }
        .puzzle-piece {
            cursor: pointer; background-repeat: no-repeat;
            transition: transform 0.2s ease, filter 0.2s ease;
            border: 1px solid rgba(255,255,255,0.3);
        }
        .puzzle-piece:hover { filter: brightness(1.2); }
        .puzzle-piece.selected {
            transform: scale(0.92); border: 2px solid #ffeb3b; z-index: 2; box-shadow: 0 0 10px #ffeb3b;
        }
        #puzzle-close-btn {
            margin-top: 25px; padding: 10px 20px; background: #d9534f; color: white;
            border: none; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 1rem;
        }
        .loader-puzzle { color: white; font-size: 1.2rem; margin-top: 20px; }
    `;
    document.head.appendChild(style);
}

function setupGame4() {
    gameDialog.classList.add('d-none'); // Sembunyikan dialog biasa

    injectPuzzleCSS();
    
    // Buat wadah overlay
    let overlay = document.createElement('div');
    overlay.id = 'puzzle-overlay';
    overlay.innerHTML = `<div class="loader-puzzle">Menganalisis Dimensi Arsip... Mengunduh Gambar...</div>`;
    document.body.appendChild(overlay);

    // Animasi masuk
  setTimeout(() => overlay.classList.add('show'), 50);

    // 1. Ganti spasi dengan underscore agar dikenali server Wikimedia
    let safeFilename = targetGameData.imageFilename.replace(/ /g, '_');
    
    // Resolusi diatur ke width 800 sesuai spesifikasi
    let imgUrl = `${COMMONS_WIKI_URL_PREF}Special:FilePath/${encodeURIComponent(safeFilename)}?width=500`;
    
    let imgTemp = new Image();
    // 2. HAPUS atau comment baris crossOrigin di bawah ini
    // imgTemp.crossOrigin = "Anonymous"; 
    
    imgTemp.onload = function() {
        let ratio = imgTemp.naturalWidth / imgTemp.naturalHeight;
        let cols, rows, totalPieces;
        
        // Aturan Grid Dinamis (Solusi Dimensi V2)
        if (ratio > 2.0) { cols = 5; rows = 2; totalPieces = 10; } // 5x2 (Panorama Ekstrem)
        else if (ratio < 0.5) { cols = 2; rows = 5; totalPieces = 10; } // 2x5 (Potret Ekstrem)
        else { cols = 3; rows = 3; totalPieces = 9; } // 3x3 (Standar)
        
        renderPuzzleBoard(imgUrl, cols, rows, totalPieces, ratio, overlay);
    };

    imgTemp.onerror = function() {
        overlay.innerHTML = `<div class="loader-puzzle" style="color:#d9534f;">Gagal memuat arsip. Melewati ronde...</div>`;
        setTimeout(() => { tutupPuzzle(false); }, 2000);
    };

    imgTemp.src = imgUrl; // Picu load gambar
}

// Fungsi Fisher-Yates anti-urut
function getShuffledArray(length) {
    let arr = Array.from({length}, (_, i) => i);
    let target = [...arr];
    let isSame = true;
    
    while(isSame) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        isSame = arr.every((val, index) => val === target[index]);
    }
    return arr;
}

function renderPuzzleBoard(imgUrl, cols, rows, totalPieces, ratio, overlay) {
    let currentState = getShuffledArray(totalPieces);
    let targetState = Array.from({length: totalPieces}, (_, i) => i);
    let selectedSlot = null;
    
    // --- LOGIKA MENCEGAH OVERFLOW LAYAR ---
    // Batas maksimal ukuran board (90% lebar layar atau maks 600px, 65% tinggi layar)
    const maxBoardWidth = Math.min(window.innerWidth * 0.9, 600); 
    const maxBoardHeight = window.innerHeight * 0.65; // Disisakan 35% untuk judul & tombol

    let finalWidth, finalHeight;

    if (maxBoardWidth / ratio <= maxBoardHeight) {
        // Gambar Cenderung Persegi / Panorama (Lebar yang jadi patokan utama)
        finalWidth = maxBoardWidth;
        finalHeight = maxBoardWidth / ratio;
    } else {
        // Gambar Potret Panjang (Tinggi yang jadi patokan utama agar tidak tembus bawah layar)
        finalHeight = maxBoardHeight;
        finalWidth = maxBoardHeight * ratio;
    }
    // ---------------------------------------
    
    // Perhatikan perubahan pada <div id="puzzle-board"...> di bawah ini
    overlay.innerHTML = `
        <div id="puzzle-title">Tantangan Puncak: Restorasi Arsip<br><span style="font-size:0.9rem; font-weight:normal;">Klik kotak untuk menukar posisi visual!</span></div>
        <div id="puzzle-board" style="width: ${finalWidth}px; height: ${finalHeight}px; grid-template-columns: repeat(${cols}, 1fr); grid-template-rows: repeat(${rows}, 1fr);"></div>
        <button id="puzzle-close-btn">Menyerah & Lewati</button>
    `;
    
    const board = document.getElementById('puzzle-board');
    
    // Render potongan
    for (let i = 0; i < totalPieces; i++) {
        let piece = document.createElement('div');
        piece.className = 'puzzle-piece';
        piece.dataset.slot = i;
        piece.style.backgroundImage = `url("${imgUrl}")`;
        piece.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
        
        updatePieceVisual(piece, currentState[i], cols, rows);
        
        piece.addEventListener('click', function() {
            if (board.classList.contains('solved')) return;
            let slot = parseInt(this.dataset.slot);
            
            if (selectedSlot === null) {
                selectedSlot = slot;
                this.classList.add('selected');
            } else if (selectedSlot === slot) {
                selectedSlot = null;
                this.classList.remove('selected');
            } else {
                let prevElement = board.querySelector(`[data-slot="${selectedSlot}"]`);
                prevElement.classList.remove('selected');
                
                // Swap State Array
                let temp = currentState[slot];
                currentState[slot] = currentState[selectedSlot];
                currentState[selectedSlot] = temp;
                
                // Swap Visual Background
                updatePieceVisual(this, currentState[slot], cols, rows);
                updatePieceVisual(prevElement, currentState[selectedSlot], cols, rows);
                selectedSlot = null;
                
                // Evaluasi Kemenangan
                if (currentState.every((val, idx) => val === targetState[idx])) {
                    board.classList.add('solved');
                    gameScore++;
                    document.getElementById('puzzle-title').innerHTML = `Restorasi Berhasil! 🎉<br><span style="font-size:1rem; font-weight:normal;">Mengarahkan ke lokasi peta...</span>`;
                    document.getElementById('puzzle-close-btn').style.display = 'none';
                    
                    // Delay sejenak biar pemain menikmati gambarnya yang utuh
                    setTimeout(() => { tutupPuzzle(true); }, 2500);
                }
            }
        });
        board.appendChild(piece);
    }
    
    document.getElementById('puzzle-close-btn').onclick = function() { tutupPuzzle(false); };
}

function updatePieceVisual(element, originalIdx, cols, rows) {
    let posX = (originalIdx % cols) * (100 / (cols - 1));
    let posY = Math.floor(originalIdx / cols) * (100 / (rows - 1));
    element.style.backgroundPosition = `${posX}% ${posY}%`;
}

function tutupPuzzle(isWin, skipAkhiriGameMode = false) {
    let overlay = document.getElementById('puzzle-overlay');
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 500);
    }

    if (skipAkhiriGameMode) return; // Digunakan jika pemain menekan tombol skip dari UI menu induk

    if (isWin) {
        // Transisi mirip akhir evaluasi game standar
        Map.flyTo([targetGameData.lat, targetGameData.lon], 17, { duration: 1.5 });
        setTimeout(() => {
            bukaPanelEksklusif(targetGameData.id);
            setTimeout(() => {
                if (Map) Map.closePopup();
                tutupPanelEksklusif();
                currentGameRound++; 
                akhiriGameMode(true);
            }, 5000);
        }, 1500);
    } else {
        currentGameRound++;
        akhiriGameMode(true);
    }
}


// ==========================================
// 5. HELPER PANEL (Tanpa Ubah URL Hash)
// ==========================================
function bukaPanelEksklusif(qid) {
    displayRecordDetails(qid); 
    
    const gameDialog = document.getElementById('game-dialog');
    if (gameDialog) gameDialog.classList.add('d-none');

    const panelMobile = document.getElementById('panel');
    if (panelMobile) {
        panelMobile.classList.remove('terkunci-game');
    }

    setTimeout(() => {
        if (typeof window.setMobilePanelExpanded === 'function') {
            window.setMobilePanelExpanded(true, true);
        }
    }, 50);
}

function tutupPanelEksklusif() {
    if (typeof window.setMobilePanelExpanded === 'function') {
        window.setMobilePanelExpanded(false, true); 
    }
    
    const panelMobile = document.getElementById('panel');
    if (panelMobile) {
        panelMobile.classList.add('terkunci-game');
    }
    
    setTimeout(() => {
        displayPanelContent('index'); 
    }, 400);
}

// ==========================================
// 6. MANAJEMEN TIMEOUT & AKHIRI GAME
// ==========================================
function clearAllGameTimeouts() {
    gameTimeouts.forEach(t => clearTimeout(t));
    gameTimeouts = [];
}

function akhiriGameMode(isMenang = false) {
    clearAllGameTimeouts();
    if (gameDialog) gameDialog.classList.add('d-none');

    if (isMenang) {
        gameOverlay.classList.add('lock-screen');
        gameOverlay.classList.remove('d-none');
        
        setTimeout(() => {
            let pesanSkor = gameScore > 0 
                ? `Selamat!<br>Anda menjawab benar <b>${gameScore}</b> dari <b>4</b> tantangan!<br>Bermain lagi?`
                : `Anda belum berhasil menjawab pertanyaan dengan benar!<br>Bermain lagi?`;
            
            tampilkanDialog(pesanSkor, "confirm", "Skor Akhir").then(mauMainLagi => {
                lakukanPembersihanUIGame();
                if (mauMainLagi) {
                    document.getElementById('btn-mulai-game').click();
                }
            });
        }, 500);
    } else {
        lakukanPembersihanUIGame();
    }
}

function lakukanPembersihanUIGame() {
    isGameMode = false;
    currentDisplayedQid = null;

    const elemenDikunci = ['panel', 'branding', 'panel-handle'];
    elemenDikunci.forEach(id => {
        let el = document.getElementById(id);
        if (el) el.classList.remove('terkunci-game');
    });

    if (gameClusterLayer) {
        Map.removeLayer(gameClusterLayer);
        gameClusterLayer = null;
    }
    gameOverlay.classList.remove('lock-screen', 'ronde-1', 'ronde-lanjut');
    gameOverlay.classList.add('d-none');
    document.getElementById('game-title').textContent = "Tantangan Game!";

    // Hapus overlay puzzle jika masih menempel akibat interupsi paksa
    let overlayPuzzle = document.getElementById('puzzle-overlay');
    if (overlayPuzzle) overlayPuzzle.remove();

    navHasil.classList.remove('nav-disabled');
    navBeranda.textContent = "Beranda";
    navBeranda.classList.remove('text-danger');
    setTimeout(() => {
        navBeranda.setAttribute('href', '#');
    }, 50);
    
    btnMenuInduk.textContent = "Lainnya";
    btnMenuInduk.classList.remove('text-primary');
    let subMenu = document.getElementById('submenu-atas');
    if (subMenu) subMenu.classList.add('d-none');
    
    if (Object.keys(savedFilterState).length > 0) {
        currentRegionFilter = savedFilterState.region;
        currentUsiaFilter = savedFilterState.usia;
        currentUsiaSort = savedFilterState.sort;
        currentSearchQuery = savedFilterState.search;
        activeFeatures = new Set(savedFilterState.features);
        
        let selectRegion = document.getElementById('filter-region');
        if(selectRegion) selectRegion.value = currentRegionFilter;
        
        let selectKombinasi = document.getElementById('filter-sort-kombinasi');
        if(selectKombinasi) selectKombinasi.value = (currentUsiaFilter !== 'all' || currentUsiaSort !== 'default') ? (currentUsiaFilter === 'all' ? `sort-${currentUsiaSort}` : `filter-${currentUsiaFilter}`) : 'default';

        let searchInput = document.getElementById('search-input');
        if(searchInput) searchInput.value = currentSearchQuery;

        document.querySelectorAll('.feat-btn').forEach(btn => {
            let type = btn.getAttribute('data-filter');
            if (activeFeatures.has(type)) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        
        let btnAll = document.getElementById('btn-all');
        if (btnAll) {
            if (savedFilterState.isAllActive) btnAll.classList.add('active');
            else btnAll.classList.remove('active');
        }
    }

    applyIntersectionFilter(true);
    Map.closePopup();
    
    displayPanelContent('index');
    if (typeof window.setMobilePanelExpanded === 'function') {
        window.setMobilePanelExpanded(false, false);
    }
}
