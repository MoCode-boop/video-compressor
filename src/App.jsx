import React, { useState, useEffect, useRef } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Sun, Moon, UploadCloud, Trash2 } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

function App() {
    const [theme, setTheme] = useState(
        () => localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    );

    const [loaded, setLoaded] = useState(false);
    const [loadingMsg, setLoadingMsg] = useState('Initializing FFmpeg...');
    const [targetSize, setTargetSize] = useState(25);
    const [files, setFiles] = useState([]);

    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [logs, setLogs] = useState([]);

    const [isDone, setIsDone] = useState(false);
    const [downloadUrl, setDownloadUrl] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    const ffmpegRef = useRef(new FFmpeg());
    const dropZoneRef = useRef(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    useEffect(() => {
        load();
    }, []);

    const toggleTheme = () => {
        setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
    };

    const load = async () => {
        const ffmpeg = ffmpegRef.current;

        ffmpeg.on('log', ({ message }) => {
            setLogs(prev => [...prev.slice(-10), message]);
        });

        ffmpeg.on('progress', ({ progress, time }) => {
            setProgress(Math.round(progress * 100));
        });

        const coreURL = await toBlobURL(`https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm`, 'application/wasm');

        try {
            await ffmpeg.load({
                coreURL,
                wasmURL,
            });
            setLoaded(true);
        } catch (err) {
            setErrorMsg('Failed to load FFmpeg. Check your network connection.');
            console.error(err);
        }
    };

    const getDuration = (file) => {
        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = function () {
                window.URL.revokeObjectURL(video.src);
                resolve(video.duration);
            }
            video.src = URL.createObjectURL(file);
        });
    };

    const handleFiles = (selectedFiles) => {
        const valid = Array.from(selectedFiles).filter(f =>
            f.name.toLowerCase().endsWith('.mp4') || f.name.toLowerCase().endsWith('.mov')
        );

        if (valid.length < selectedFiles.length) {
            alert("Some files were discarded. Only .mp4 and .mov are supported.");
        }

        setFiles(prev => [...prev, ...valid]);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        dropZoneRef.current.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        dropZoneRef.current.classList.add('dragover');
    };

    const handleDragLeave = () => {
        dropZoneRef.current.classList.remove('dragover');
    };

    const removeFile = (index) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const compressVideos = async () => {
        if (files.length === 0) return;
        setIsProcessing(true);
        setLogs([]);
        setErrorMsg('');
        setProgress(0);

        const zip = new JSZip();
        const ffmpeg = ffmpegRef.current;
        let successCount = 0;

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                setLoadingMsg(`Compressing ${file.name} (${i + 1}/${files.length})...`);

                const duration = await getDuration(file);

                // Target Size MB -> Bits
                const targetBits = targetSize * 8 * 1024 * 1024;
                const bitrate = (targetBits / duration) / 1000; // in kbps

                const inputName = `input_${i}_${file.name}`;
                const outputName = `compressed_${file.name}`;

                await ffmpeg.writeFile(inputName, await fetchFile(file));

                await ffmpeg.exec([
                    '-i', inputName,
                    '-b:v', `${Math.floor(bitrate)}k`,
                    '-c:v', 'libx264',
                    '-c:a', 'copy',
                    outputName
                ]);

                try {
                    const data = await ffmpeg.readFile(outputName);
                    zip.file(outputName, data.buffer);
                    successCount++;
                } catch (e) {
                    console.error(`Failed reading output for ${file.name}`, e);
                }
            }

            if (successCount === 0) {
                throw new Error('No files were successfully compressed.');
            }

            setLoadingMsg('Generating ZIP archive...');
            const content = await zip.generateAsync({ type: 'blob' });
            setDownloadUrl(URL.createObjectURL(content));
            setIsDone(true);

        } catch (err) {
            setErrorMsg(err.message || 'An error occurred during compression.');
        } finally {
            setIsProcessing(false);
        }
    };

    const resetUI = () => {
        setFiles([]);
        setIsDone(false);
        setDownloadUrl('');
        setErrorMsg('');
        setProgress(0);
    };

    if (!loaded && !errorMsg) {
        return (
            <div className="container">
                <div className="status-container">
                    <div className="spinner"></div>
                    <p>{loadingMsg}</p>
                    <div className="log-box">
                        {logs.map((L, i) => <div key={i}>{L}</div>)}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <header>
                <div className="header-content">
                    <div>
                        <h1>Video Compressor</h1>
                        <p>Runs securely in your browser locally. Upload .mov or .mp4</p>
                    </div>
                    <button id="theme-toggle" className="icon-btn" aria-label="Toggle theme" onClick={toggleTheme}>
                        {theme === 'dark' ? <Moon size={24} /> : <Sun size={24} />}
                    </button>
                </div>
            </header>

            <main>
                {!isProcessing && !isDone && !errorMsg && (
                    <div>
                        <div className="controls">
                            <label>Target size per video (MB):</label>
                            <input
                                type="number"
                                value={targetSize}
                                onChange={e => setTargetSize(Number(e.target.value))}
                                min="1"
                            />
                        </div>

                        <div
                            className="drop-zone"
                            ref={dropZoneRef}
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onClick={() => fileInputRef.current.click()}
                        >
                            <div className="drop-zone-content">
                                <UploadCloud size={48} className="upload-icon" />
                                <p>Drag and drop video files here (.mp4, .mov) or Click to Browse</p>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    multiple
                                    accept=".mp4,.mov"
                                    style={{ display: 'none' }}
                                    onChange={(e) => handleFiles(e.target.files)}
                                />
                            </div>
                        </div>

                        <div className="file-list">
                            {files.map((file, i) => (
                                <div key={i} className="file-item">
                                    <span>{file.name.substring(0, 30)}{file.name.length > 30 ? '...' : ''} ({(file.size / (1024 * 1024)).toFixed(1)} MB)</span>
                                    <span className="remove-btn" onClick={() => removeFile(i)}><Trash2 size={16} /></span>
                                </div>
                            ))}
                        </div>

                        <button
                            className="btn btn-primary"
                            disabled={files.length === 0}
                            onClick={compressVideos}
                        >
                            Compress {files.length} Video{files.length !== 1 ? 's' : ''}
                        </button>
                    </div>
                )}

                {isProcessing && (
                    <div className="status-container">
                        <div className="spinner"></div>
                        <p>{loadingMsg}</p>
                        <p>Overall Engine Progress: {progress}%</p>
                        <div className="log-box">
                            {logs.map((L, i) => <div key={i}>{L}</div>)}
                        </div>
                    </div>
                )}

                {isDone && (
                    <div className="success-container">
                        <p>Compression complete!</p>
                        <a href={downloadUrl} download="compressed_videos.zip" className="btn btn-primary">Download ZIP</a>
                        <button onClick={resetUI} className="btn" style={{ marginTop: '10px', width: '100%' }}>Compress more</button>
                    </div>
                )}

                {errorMsg && (
                    <div className="error-container">
                        <p>{errorMsg}</p>
                        <button onClick={() => { setErrorMsg(''); setIsProcessing(false); }} className="btn btn-primary">Try Again</button>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
