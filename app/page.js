'use client';

import { useState, useEffect, useRef } from 'react';

export default function Home() {
  const [faceapiLoaded, setFaceapiLoaded] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState('tiny'); // 'tiny' or 'ssd'
  const [loadingProgress, setLoadingProgress] = useState('');
  
  // Selection Screen State: null (welcome menu), 'realtime', or 'capture'
  const [scanType, setScanType] = useState(null);
  
  // App state
  const [activeMode, setActiveMode] = useState('scan'); // 'scan' or 'register'
  const [showAdmin, setShowAdmin] = useState(false); // Controls admin drawer
  
  // Camera & Detection status
  const [hasCamera, setHasCamera] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [faceDetected, setFaceDetected] = useState(false);
  
  // Database status & List
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [isDbLoading, setIsDbLoading] = useState(false);
  const [isDbSettingUp, setIsDbSettingUp] = useState(false);
  
  // Registration form
  const [registerName, setRegisterName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  
  // Recognition Result
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [matchResult, setMatchResult] = useState(null);
  const [matchStatus, setMatchStatus] = useState('idle'); // 'idle', 'searching', 'matched', 'unknown', 'error'
  
  // Flicker prevention: Persist last matched name while searching
  const [persistMatchedName, setPersistMatchedName] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Refs for video & canvas
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const faceapiRef = useRef(null);
  const loopRef = useRef(null);
  
  // Sync states to refs to avoid closure stale values in the fast loop
  const activeModeRef = useRef(activeMode);
  const isRecognizingRef = useRef(isRecognizing);
  const lastMatchTimeRef = useRef(0);
  const currentDescriptorRef = useRef(null);
  const selectedModelRef = useRef(selectedModel);
  const scanTypeRef = useRef(scanType);

  useEffect(() => {
    activeModeRef.current = activeMode;
  }, [activeMode]);

  useEffect(() => {
    isRecognizingRef.current = isRecognizing;
  }, [isRecognizing]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    scanTypeRef.current = scanType;
  }, [scanType]);

  // 1. Dynamic import face-api.js inside useEffect to completely prevent SSR build failures
  useEffect(() => {
    const initFaceApi = async () => {
      try {
        setLoadingProgress('Memuat AI Engine...');
        const faceapi = await import('@vladmandic/face-api');
        faceapiRef.current = faceapi;
        setFaceapiLoaded(true);
        await loadModels(faceapi, selectedModel);
      } catch (err) {
        console.error('Failed to import face-api:', err);
        setLoadingProgress('Gagal memuat AI Engine.');
      }
    };
    
    initFaceApi();
    fetchUsers();

    return () => {
      stopLoop();
      stopCamera();
    };
  }, []);

  // 2. Fetch registered users from PostgreSQL
  const fetchUsers = async () => {
    setIsDbLoading(true);
    try {
      const res = await fetch('/api/faces');
      const result = await res.json();
      if (result.success) {
        setRegisteredUsers(result.data);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setIsDbLoading(false);
    }
  };

  // 3. Database Migration/Setup Trigger
  const handleDbSetup = async () => {
    setIsDbSettingUp(true);
    try {
      const res = await fetch('/api/setup');
      const data = await res.json();
      if (data.success) {
        alert('Database table initialized successfully!');
        fetchUsers();
      } else {
        alert(`Failed to set up database: ${data.error}`);
      }
    } catch (err) {
      console.error('Database setup failed:', err);
      alert('Setup request failed. Ensure .env.local connection string is configured.');
    } finally {
      setIsDbSettingUp(false);
    }
  };

  // 4. Load AI Models
  const loadModels = async (faceapi, modelType) => {
    setModelsLoaded(false);
    setLoadingProgress(`Memuat model wajah (${modelType === 'tiny' ? 'Cepat' : 'Akurat'})...`);
    
    try {
      const MODEL_URL = '/models';
      
      // Load landmark and recognition nets
      await Promise.all([
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);
      
      // Load specific detector
      if (modelType === 'tiny') {
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      } else {
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
      }
      
      setModelsLoaded(true);
      setLoadingProgress('');
    } catch (err) {
      console.error('Error loading models:', err);
      setLoadingProgress('Gagal memuat model weights.');
    }
  };

  // 5. Model Switcher Handler
  const handleModelChange = async (e) => {
    const nextModel = e.target.value;
    setSelectedModel(nextModel);
    
    // Stop camera and loop during model swap
    stopLoop();
    stopCamera();
    
    if (faceapiRef.current) {
      await loadModels(faceapiRef.current, nextModel);
    }
    
    // Restart camera if a mode was already selected
    if (scanType) {
      startCamera();
    }
  };

  // 6. Camera Controllers
  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setHasCamera(true);
      }
    } catch (err) {
      console.error('Error accessing camera:', err);
      setCameraError('Gagal mengakses kamera. Berikan izin akses kamera.');
      setHasCamera(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setHasCamera(false);
  };

  // 7. Video play triggers detection loop
  const handleVideoPlay = () => {
    restartDetectionLoop();
  };

  const restartDetectionLoop = () => {
    if (!videoRef.current || !canvasRef.current || !faceapiRef.current) return;
    
    const displaySize = {
      width: videoRef.current.videoWidth || 640,
      height: videoRef.current.videoHeight || 480
    };
    
    // Resize canvas to match the exact dimensions of the feed
    faceapiRef.current.matchDimensions(canvasRef.current, displaySize);
    
    stopLoop();
    
    // Run detection loop at ~75ms interval for real-time bounding box tracking.
    // Realtime matching queries Postgres every 1.5s.
    // Capture mode only does local box rendering, no DB queries until clicked.
    loopRef.current = setInterval(async () => {
      await processFrame(displaySize);
    }, 75);
  };

  const stopLoop = () => {
    if (loopRef.current) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
    setFaceDetected(false);
  };

  // 8. Main frame processor
  const processFrame = async (displaySize) => {
    const faceapi = faceapiRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || !faceapi) return;
    
    // Clear canvas before drawing
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Load correct options
    const options = selectedModelRef.current === 'tiny'
      ? new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.55 })
      : new faceapi.SsdMobilenetv1Options({ minConfidence: 0.55 });
      
    try {
      // Run face detection + landmark + descriptors extraction
      const detection = await faceapi
        .detectSingleFace(video, options)
        .withFaceLandmarks()
        .withFaceDescriptor();
        
      if (detection) {
        setFaceDetected(true);
        currentDescriptorRef.current = detection.descriptor;
        
        // Draw real-time bounding box overlays
        const resizedDetection = faceapi.resizeResults(detection, displaySize);
        
        // Custom stylization of face bounding box
        const { box } = resizedDetection.detection;
        ctx.strokeStyle = activeModeRef.current === 'scan' ? '#00f2fe' : '#6366f1';
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        
        // Trigger matching if in scanning mode AND realtime scan type
        if (activeModeRef.current === 'scan' && scanTypeRef.current === 'realtime') {
          const now = Date.now();
          if (now - lastMatchTimeRef.current > 1500 && !isRecognizingRef.current) {
            lastMatchTimeRef.current = now;
            await performRecognition(detection.descriptor);
          }
        }
      } else {
        setFaceDetected(false);
        currentDescriptorRef.current = null;
        if (activeModeRef.current === 'scan' && scanTypeRef.current === 'realtime') {
          // Reset status only in realtime mode if face leaves camera
          setMatchStatus('idle');
          setPersistMatchedName(null);
          setMatchResult(null);
        }
      }
    } catch (err) {
      console.error('Frame loop error:', err);
    }
  };

  // 9. Match face via backend L2 PostgreSQL query
  const performRecognition = async (descriptor) => {
    setIsRecognizing(true);
    setMatchStatus('searching');
    try {
      const res = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptor: Array.from(descriptor) })
      });
      const data = await res.json();
      
      if (data.success) {
        if (data.match) {
          setMatchResult(data.matchedUser);
          setPersistMatchedName(data.matchedUser.name);
          setMatchStatus('matched');
        } else {
          setMatchResult(null);
          setPersistMatchedName(null);
          setMatchStatus('unknown');
        }
      } else {
        setMatchStatus('error');
      }
    } catch (err) {
      console.error('Match API call error:', err);
      setMatchStatus('error');
    } finally {
      setIsRecognizing(false);
    }
  };

  // 10. Capture & Match Single Frame Trigger (Capture Mode)
  const handleCaptureAndRecognize = async () => {
    if (!currentDescriptorRef.current) {
      alert('Wajah tidak terdeteksi. Silakan menghadap ke kamera.');
      return;
    }
    
    setIsCapturing(true);
    setMatchStatus('searching');
    setPersistMatchedName(null);
    
    try {
      const res = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptor: Array.from(currentDescriptorRef.current) })
      });
      const data = await res.json();
      
      if (data.success) {
        if (data.match) {
          setMatchResult(data.matchedUser);
          setPersistMatchedName(data.matchedUser.name);
          setMatchStatus('matched');
        } else {
          setMatchResult(null);
          setPersistMatchedName(null);
          setMatchStatus('unknown');
        }
        // Pause/stop the detection loop so the screen is frozen on the capture result
        stopLoop();
      } else {
        setMatchStatus('error');
      }
    } catch (err) {
      console.error('Capture match API call error:', err);
      setMatchStatus('error');
    } finally {
      setIsCapturing(false);
    }
  };

  // Reset capture results and restart tracking loop
  const handleResetCapture = () => {
    setMatchResult(null);
    setPersistMatchedName(null);
    setMatchStatus('idle');
    restartDetectionLoop();
  };

  // 11. Register face click handler
  const handleRegisterFace = async (e) => {
    e.preventDefault();
    
    if (!registerName.trim()) {
      alert('Masukkan nama lengkap.');
      return;
    }
    
    if (!currentDescriptorRef.current) {
      alert('Wajah tidak terdeteksi. Silakan menghadap ke kamera.');
      return;
    }
    
    setIsRegistering(true);
    
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: registerName.trim(),
          descriptor: Array.from(currentDescriptorRef.current)
        })
      });
      const result = await res.json();
      
      if (result.success) {
        const registeredName = result.data.name;
        setRegisterName('');
        alert(`Berhasil mendaftarkan wajah "${registeredName}"!`);
        fetchUsers();
        handleModeSwitch('scan');
      } else {
        alert(`Gagal meregistrasi wajah: ${result.error}`);
      }
    } catch (err) {
      console.error('Register API error:', err);
      alert('Terjadi kesalahan jaringan.');
    } finally {
      setIsRegistering(false);
    }
  };

  // 12. Delete face click handler
  const handleDeleteFace = async (id, name) => {
    if (!confirm(`Hapus biometrik wajah "${name}"?`)) {
      return;
    }
    
    try {
      const res = await fetch(`/api/faces?id=${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        fetchUsers();
        if (matchResult && matchResult.id === id) {
          setMatchResult(null);
          setPersistMatchedName(null);
          setMatchStatus('idle');
          if (scanType === 'capture') {
            restartDetectionLoop();
          }
        }
      } else {
        alert(`Gagal menghapus: ${data.error}`);
      }
    } catch (err) {
      console.error('Delete API error:', err);
    }
  };

  // Selection Screen Switcher
  const handleSelectMode = (type) => {
    setScanType(type);
    setMatchResult(null);
    setPersistMatchedName(null);
    setMatchStatus('idle');
    // Start camera stream when mode is selected
    startCamera();
  };

  // Back to Menu Home Screen
  const handleBackToMenu = () => {
    stopLoop();
    stopCamera();
    setScanType(null);
    setMatchResult(null);
    setPersistMatchedName(null);
    setMatchStatus('idle');
  };

  const handleModeSwitch = (mode) => {
    setActiveMode(mode);
    setRegisterName('');
    setMatchResult(null);
    setPersistMatchedName(null);
    setMatchStatus('idle');
    // If returning to scan in capture mode, restart camera tracking loop
    if (mode === 'scan' && scanType === 'capture') {
      restartDetectionLoop();
    }
  };

  return (
    <div className="kiosk-container">
      {/* Kiosk Card Frame */}
      <div className={`kiosk-card ${
        matchStatus === 'searching' ? 'matching' :
        matchStatus === 'matched' ? 'matched' : 
        matchStatus === 'unknown' ? 'unknown' : ''
      }`}>
        
        {/* Render Welcome Screen Selection if scanType is null */}
        {scanType === null ? (
          <div className="welcome-container">
            <h1 className="welcome-title-glow">SIAPAKAH DIA</h1>
            <p className="welcome-subtitle">
              Sistem verifikasi biometrik pengenalan wajah realtime berbasis teknologi jaringan saraf tiruan.
            </p>
            
            <div className="welcome-menu">
              <button 
                className="mode-select-card" 
                onClick={() => handleSelectMode('realtime')}
                disabled={!modelsLoaded}
              >
                <span className="mode-select-title">📡 Pindai Real-time</span>
                <span className="mode-select-subtext highlight">(Disarankan untuk Windows & macOS)</span>
              </button>
              
              <button 
                className="mode-select-card" 
                onClick={() => handleSelectMode('capture')}
                disabled={!modelsLoaded}
              >
                <span className="mode-select-title">📸 Ambil Foto (1 Frame)</span>
                <span className="mode-select-subtext highlight">(Disarankan untuk Android & iOS)</span>
              </button>
            </div>
            
            {!modelsLoaded && (
              <div style={{ marginTop: '2.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span className="spinner"></span>
                <span>{loadingProgress || 'Menyiapkan modul AI...'}</span>
              </div>
            )}
          </div>
        ) : (
          /* Render Kiosk Scanner UI when a mode is active */
          <>
            {/* Header Title with Back Link and Settings */}
            <div className="kiosk-header">
              <button className="kiosk-back-btn" onClick={handleBackToMenu} disabled={isRegistering}>
                ⟨ Menu
              </button>
              
              <h1 className="kiosk-title" style={{ fontSize: '0.85rem' }}>
                {scanType === 'realtime' ? 'Real-Time' : 'Capture Mode'}
              </h1>
              
              {/* Admin Gear Button */}
              <button 
                className="admin-toggle-btn" 
                onClick={() => setShowAdmin(!showAdmin)} 
                title="Database & Settings"
                disabled={isRegistering}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </button>
            </div>

            {/* Camera Feed Window */}
            <div className="kiosk-video-container">
              {modelsLoaded && (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onPlay={handleVideoPlay}
                  className="kiosk-video"
                  style={{ display: hasCamera ? 'block' : 'none' }}
                ></video>
              )}

              {modelsLoaded && hasCamera ? (
                <>
                  {/* Corner target outlines */}
                  <div className="kiosk-target kt-tl"></div>
                  <div className="kiosk-target kt-tr"></div>
                  <div className="kiosk-target kt-bl"></div>
                  <div className="kiosk-target kt-br"></div>
                  
                  {/* Scanning neon line in realtime mode or during active loops */}
                  {activeMode === 'scan' && faceDetected && loopRef.current && (
                    <div className="kiosk-scanner-line"></div>
                  )}
                  
                  <canvas ref={canvasRef} className="kiosk-canvas"></canvas>
                </>
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)', background: '#04060b', zIndex: 15 }}>
                  {cameraError ? (
                    <div style={{ color: 'var(--color-error)' }}>
                      <p style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>⚠️</p>
                      <p style={{ fontSize: '0.75rem', maxWidth: '250px', margin: '0 auto' }}>{cameraError}</p>
                      <button 
                        className="drawer-mini-btn" 
                        style={{ marginTop: '0.75rem', marginInline: 'auto' }}
                        onClick={startCamera}
                      >
                        Coba Lagi
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="spinner" style={{ margin: '0 auto 0.75rem', display: 'block' }}></span>
                      <p style={{ fontSize: '0.8rem' }}>Membuka kamera...</p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Dynamic Status Text below Camera */}
            <div className="kiosk-feedback-wrapper">
              {activeMode === 'scan' ? (
                <>
                  <span className="kiosk-status-label">
                    {matchStatus === 'searching' && !persistMatchedName ? 'Menganalisis Biometrik...' : 'Anda Terdeteksi Sebagai'}
                  </span>
                  <span className={`kiosk-name-label ${
                    matchStatus === 'matched' || (matchStatus === 'searching' && persistMatchedName) ? 'matched' :
                    matchStatus === 'unknown' ? 'unknown' :
                    faceDetected ? 'detected' : ''
                  }`}>
                    {persistMatchedName ? persistMatchedName.toUpperCase() :
                     matchStatus === 'unknown' ? 'WAJAH TIDAK DIKENAL' :
                     matchStatus === 'searching' ? 'MENCARI...' :
                     faceDetected ? 'DETEKSI AKTIF...' : '(TIDAK ADA DETEKSI)'}
                  </span>
                </>
              ) : (
                <>
                  <span className="kiosk-status-label" style={{ marginBottom: '0.15rem' }}>Registrasi Wajah</span>
                  <input
                    type="text"
                    className="kiosk-input"
                    placeholder="Masukkan nama lengkap"
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                    disabled={isRegistering}
                    style={{ height: '40px', padding: '0 12px', fontSize: '0.85rem', textAlign: 'center' }}
                    maxLength={40}
                  />
                </>
              )}
            </div>

            {/* Bottom Actions based on scanType */}
            <div style={{ width: '100%' }}>
              {activeMode === 'scan' ? (
                /* Scanning mode buttons */
                scanType === 'realtime' ? (
                  /* Real-time Mode Actions */
                  <button 
                    className="kiosk-btn-pill" 
                    onClick={() => handleModeSwitch('register')}
                    disabled={!modelsLoaded}
                  >
                    DAFTAR SEKARANG
                  </button>
                ) : (
                  /* Capture 1 Frame Mode Actions */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                    {matchStatus === 'matched' || matchStatus === 'unknown' ? (
                      /* If snapshot is captured and has results, show restart button */
                      <>
                        <button className="kiosk-btn-pill kiosk-btn-primary" onClick={handleResetCapture}>
                          🔄 PINDAI LAGI
                        </button>
                        <button 
                          className="drawer-mini-btn" 
                          style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '4px', alignSelf: 'center' }}
                          onClick={() => handleModeSwitch('register')}
                        >
                          Daftar Biometrik Ini
                        </button>
                      </>
                    ) : (
                      /* Otherwise, show Capture button */
                      <>
                        <button 
                          className="kiosk-btn-pill kiosk-btn-primary"
                          onClick={handleCaptureAndRecognize}
                          disabled={isCapturing || !faceDetected}
                        >
                          {isCapturing ? <span className="spinner"></span> : '📸 AMBIL FOTO & COCOKKAN'}
                        </button>
                        <button 
                          className="drawer-mini-btn" 
                          style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '4px', alignSelf: 'center' }}
                          onClick={() => handleModeSwitch('register')}
                        >
                          Registrasi Baru
                        </button>
                      </>
                    )}
                  </div>
                )
              ) : (
                /* Registration Mode Actions (Shared) */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                  <button 
                    className="kiosk-btn-pill kiosk-btn-primary" 
                    onClick={handleRegisterFace}
                    disabled={isRegistering || !faceDetected || !registerName.trim()}
                  >
                    {isRegistering ? <span className="spinner"></span> : 'SIMPAN WAJAH'}
                  </button>
                  <button 
                    className="drawer-mini-btn" 
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', padding: '4px', alignSelf: 'center' }}
                    onClick={() => handleModeSwitch('scan')}
                    disabled={isRegistering}
                  >
                    Batal
                  </button>
                </div>
              )}
            </div>

            {/* Sliding Admin Drawer Overlay */}
            <div className={`admin-drawer ${showAdmin ? 'open' : ''}`}>
              <div className="drawer-header">
                <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pengaturan & Basis Data</h3>
                <button className="drawer-close-btn" onClick={() => setShowAdmin(false)}>&times;</button>
              </div>
              
              {/* Models options */}
              <div className="form-group" style={{ gap: '0.35rem' }}>
                <label className="form-label" style={{ fontSize: '0.7rem' }}>Model Detektor Wajah</label>
                <select 
                  className="kiosk-input"
                  value={selectedModel}
                  onChange={handleModelChange}
                  disabled={!faceapiLoaded}
                  style={{ padding: '0.5rem', fontSize: '0.8rem', height: '36px' }}
                >
                  <option value="tiny">Tiny Face Detector (Cepat)</option>
                  <option value="ssd">SSD MobileNet (Akurat)</option>
                </select>
              </div>

              {/* Database Auto Setup Status */}
              <div style={{ padding: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--card-border)', borderRadius: '8px', fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                Tabel Postgres dikonfigurasi untuk terinisiasi otomatis secara default.
              </div>

              {/* Registered Signatures list */}
              <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem', overflow: 'hidden' }}>
                <span className="form-label" style={{ fontSize: '0.7rem' }}>Biometrik Terdaftar ({registeredUsers.length})</span>
                
                <div className="drawer-list">
                  {isDbLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
                      <span className="spinner"></span>
                    </div>
                  ) : registeredUsers.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      Belum ada wajah terdaftar.
                    </div>
                  ) : (
                    registeredUsers.map((user) => (
                      <div 
                        key={user.id} 
                        style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center', 
                          padding: '0.5rem 0.75rem', 
                          background: 'rgba(255,255,255,0.02)', 
                          border: '1px solid var(--card-border)', 
                          borderRadius: '8px',
                          fontSize: '0.8rem'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600 }}>{user.name}</span>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                            ID: {user.id} • {new Date(user.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        
                        <button 
                          className="delete-btn" 
                          onClick={() => handleDeleteFace(user.id, user.name)}
                          style={{ padding: '2px', borderRadius: '4px' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
        
      </div>
    </div>
  );
}
