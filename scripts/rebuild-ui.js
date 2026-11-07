/**
 * SPLITWISE QUANTUM — COMPLETE UI REPLACEMENT & DESIGN SYSTEM
 * Builds a completely new frontend interface from scratch at the UI component level
 * Inspired by Vercel, Linear, Stripe, and Resend.
 * Zero usage of old Stitch designs.
 * Preserves 100% of application logic, DOM IDs, and event handlers.
 */
const fs = require('fs');
const path = require('path');

const backupPath = path.join(__dirname, '..', 'index.html.backup');
const originalContent = fs.readFileSync(backupPath, 'utf8');

// Find script 6 (Application Logic)
const scriptStartIndex = originalContent.indexOf('<script>\n        const API =');
if (scriptStartIndex === -1) {
    throw new Error('Could not find start of application logic script');
}

let scriptPart = originalContent.slice(scriptStartIndex);

console.log('Script length:', scriptPart.length);

// Build the new HEAD & DESIGN SYSTEM
const newHead = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover"/>
    <title>SplitWise Quantum — Financial Ledger & Debt Automation</title>

    <!-- Google Fonts: Inter & Plus Jakarta Sans for Swiss SaaS Typography -->
    <link rel="preconnect" href="https://fonts.googleapis.com"/>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet"/>

    <!-- Chart.js, jsPDF & Confetti -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js"></script>

    <!-- Tailwind CSS with Quantum SaaS Tokens -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        quantum: {
                            50: "#f0fdf4",
                            100: "#dcfce7",
                            200: "#bbf7d0",
                            300: "#86efac",
                            400: "#4ade80",
                            500: "#10b981",
                            600: "#059669",
                            700: "#047857",
                            800: "#065f46",
                            900: "#064e3b",
                            950: "#022c22",
                        },
                        obsidian: {
                            50: "#f8fafc",
                            100: "#f1f5f9",
                            200: "#e2e8f0",
                            300: "#cbd5e1",
                            400: "#94a3b8",
                            500: "#64748b",
                            600: "#475569",
                            700: "#334155",
                            800: "#1e293b",
                            900: "#0f172a",
                            950: "#08090d",
                        },
                        primary: "#10b981",
                        "primary-container": "#059669",
                        "on-primary": "#ffffff",
                        "on-primary-container": "#022c22",
                        secondary: "#6366f1",
                        "secondary-container": "#4f46e5",
                        "on-secondary": "#ffffff",
                        surface: "var(--bg-canvas)",
                        "surface-dim": "var(--bg-surface-subtle)",
                        "surface-container-lowest": "var(--bg-surface)",
                        "surface-container-low": "var(--bg-surface-subtle)",
                        "surface-container": "var(--bg-surface-elevated)",
                        "surface-container-high": "var(--bg-surface-hover)",
                        "on-surface": "var(--text-main)",
                        "on-surface-variant": "var(--text-muted)",
                        outline: "var(--border-strong)",
                        "outline-variant": "var(--border-subtle)",
                        error: "#f43f5e",
                        "error-container": "#ffe4e6",
                        "on-error": "#ffffff",
                    },
                    fontFamily: {
                        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
                        mono: ['JetBrains Mono', 'monospace'],
                    },
                    boxShadow: {
                        'glow-emerald': '0 0 25px -5px rgba(16, 185, 129, 0.25)',
                        'glow-indigo': '0 0 25px -5px rgba(99, 102, 241, 0.25)',
                        'quantum-card': 'var(--shadow-card)',
                        'quantum-elevated': 'var(--shadow-elevated)',
                    }
                }
            }
        };
    </script>
    <style>
        /* ==========================================================================
           SPLITWISE QUANTUM — CENTRALIZED TOKENS & SYSTEM ARCHITECTURE
           Independent, bespoke design system with zero legacy Stitch styles.
           ========================================================================== */
        :root {
            --bg-canvas: #f8fafc;
            --bg-surface: #ffffff;
            --bg-surface-subtle: #f1f5f9;
            --bg-surface-elevated: #eef2f6;
            --bg-surface-hover: #e2e8f0;
            --border-subtle: rgba(15, 23, 42, 0.08);
            --border-strong: rgba(15, 23, 42, 0.16);
            --border-accent: rgba(16, 185, 129, 0.3);

            --text-main: #090d16;
            --text-muted: #57606a;
            --text-faint: #8c959f;

            --brand-primary: #059669;
            --brand-primary-hover: #047857;
            --brand-primary-light: #10b981;
            --brand-primary-subtle: rgba(5, 150, 105, 0.1);
            --brand-indigo: #6366f1;
            --brand-rose: #f43f5e;
            --brand-amber: #f59e0b;
            --brand-cyan: #06b6d4;

            --shadow-subtle: 0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.04);
            --shadow-card: 0 4px 6px -1px rgba(0, 0, 0, 0.04), 0 2px 4px -2px rgba(0, 0, 0, 0.03);
            --shadow-elevated: 0 16px 32px -4px rgba(0, 0, 0, 0.08), 0 4px 8px -2px rgba(0, 0, 0, 0.04);

            --glass-bg: rgba(255, 255, 255, 0.85);
            --glass-border: rgba(15, 23, 42, 0.08);
        }

        html.dark {
            --bg-canvas: #08090d;
            --bg-surface: #0e1017;
            --bg-surface-subtle: #141722;
            --bg-surface-elevated: #1a1e2b;
            --bg-surface-hover: #222738;
            --border-subtle: rgba(255, 255, 255, 0.07);
            --border-strong: rgba(255, 255, 255, 0.15);
            --border-accent: rgba(16, 185, 129, 0.35);

            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --text-faint: #64748b;

            --brand-primary: #10b981;
            --brand-primary-hover: #059669;
            --brand-primary-light: #34d399;
            --brand-primary-subtle: rgba(16, 185, 129, 0.12);
            --brand-indigo: #818cf8;
            --brand-rose: #fb7185;
            --brand-amber: #fbbf24;
            --brand-cyan: #22d3ee;

            --shadow-subtle: 0 1px 3px 0 rgba(0, 0, 0, 0.5);
            --shadow-card: 0 4px 8px -1px rgba(0, 0, 0, 0.6), inset 0 1px 0 0 rgba(255, 255, 255, 0.05);
            --shadow-elevated: 0 24px 48px -8px rgba(0, 0, 0, 0.85), inset 0 1px 0 0 rgba(255, 255, 255, 0.08);

            --glass-bg: rgba(14, 16, 23, 0.85);
            --glass-border: rgba(255, 255, 255, 0.08);
        }

        @layer base {
            html, body {
                margin: 0;
                padding: 0;
                font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
                background-color: var(--bg-canvas);
                color: var(--text-main);
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                transition: background-color 0.25s ease, color 0.25s ease;
            }
            ::-webkit-scrollbar { width: 6px; height: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 9999px; }
            ::-webkit-scrollbar-thumb:hover { background: var(--text-faint); }
        }

        .tabular-nums { font-variant-numeric: tabular-nums; font-family: 'JetBrains Mono', monospace; }
        .material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
        .icon-fill { font-variation-settings: 'FILL' 1; }

        /* Smooth Screen-to-Screen Navigation Animation */
        @keyframes quantumViewFadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .view-panel:not(.hidden) {
            animation: quantumViewFadeIn 0.24s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        /* Modal Spring Entrance */
        @keyframes quantumModalIn {
            from { opacity: 0; transform: scale(0.96) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .quantum-modal-content {
            animation: quantumModalIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        /* Glowing AI Assistant Orb & Soundwave */
        @keyframes quantumOrbPulse {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
            70% { box-shadow: 0 0 0 16px rgba(16, 185, 129, 0); }
            100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        .quantum-orb-active {
            animation: quantumOrbPulse 2s infinite;
        }

        @keyframes soundWaveAnim {
            0%, 100% { height: 4px; }
            50% { height: 22px; }
        }
        .voice-wave-bar {
            animation: soundWaveAnim 1.2s ease-in-out infinite;
        }
        .voice-wave-bar:nth-child(2) { animation-delay: 0.15s; }
        .voice-wave-bar:nth-child(3) { animation-delay: 0.3s; }
        .voice-wave-bar:nth-child(4) { animation-delay: 0.45s; }
        .voice-wave-bar:nth-child(5) { animation-delay: 0.6s; }

        /* Unified Quantum UI Utility Classes */
        .qw-glass {
            background-color: var(--glass-bg);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid var(--glass-border);
        }

        .qw-card {
            background-color: var(--bg-surface);
            border: 1px solid var(--border-subtle);
            border-radius: 1rem;
            box-shadow: var(--shadow-subtle);
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .qw-card:hover {
            border-color: var(--border-strong);
            box-shadow: var(--shadow-card);
        }

        .qw-card-elevated {
            background-color: var(--bg-surface);
            border: 1px solid var(--border-subtle);
            border-radius: 1.25rem;
            box-shadow: var(--shadow-card);
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .qw-card-elevated:hover {
            border-color: var(--border-strong);
            box-shadow: var(--shadow-elevated);
            transform: translateY(-2px);
        }

        .qw-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            font-weight: 600;
            border-radius: 0.75rem;
            padding: 0.625rem 1rem;
            font-size: 0.875rem;
            transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
            user-select: none;
            cursor: pointer;
            outline: none;
        }
        .qw-btn:active {
            transform: scale(0.97);
        }
        .qw-btn-primary {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: #ffffff;
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.15);
        }
        .qw-btn-primary:hover {
            background: linear-gradient(135deg, #34d399 0%, #047857 100%);
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
        }
        .qw-btn-secondary {
            background-color: var(--bg-surface-subtle);
            color: var(--text-main);
            border: 1px solid var(--border-subtle);
        }
        .qw-btn-secondary:hover {
            background-color: var(--bg-surface-elevated);
            border-color: var(--border-strong);
        }
        .qw-btn-ghost {
            background: transparent;
            color: var(--text-muted);
            border: 1px solid transparent;
        }
        .qw-btn-ghost:hover {
            background-color: var(--bg-surface-subtle);
            color: var(--text-main);
        }
        .qw-btn-danger {
            background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
            color: #ffffff;
            box-shadow: 0 4px 14px rgba(244, 63, 94, 0.3);
        }

        .qw-input {
            width: 100%;
            background-color: var(--bg-surface-subtle);
            border: 1px solid var(--border-subtle);
            color: var(--text-main);
            border-radius: 0.75rem;
            padding: 0.625rem 0.875rem;
            font-size: 0.875rem;
            transition: all 0.15s ease;
            outline: none;
        }
        .qw-input:focus {
            background-color: var(--bg-surface);
            border-color: var(--brand-primary);
            box-shadow: 0 0 0 3px var(--brand-primary-subtle);
        }

        .qw-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.375rem;
            padding: 0.25rem 0.625rem;
            border-radius: 9999px;
            font-size: 0.6875rem;
            font-weight: 700;
            letter-spacing: 0.02em;
            text-transform: uppercase;
        }

        /* Navigation active item highlight */
        .nav-item.active {
            background-color: var(--brand-primary-subtle) !important;
            color: var(--brand-primary) !important;
            border-color: var(--border-accent) !important;
        }

        @media (prefers-reduced-motion: reduce) {
            * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }
    </style>
</head>
<body class="min-h-screen text-slate-900 dark:text-slate-100 selection:bg-emerald-500/20 selection:text-emerald-400">

    <!-- Global Loading Progress Bar -->
    <div id="global-loading-bar" class="fixed top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500 via-teal-400 to-indigo-500 z-50 transition-all duration-300 opacity-0 pointer-events-none"></div>

    <!-- Notification Toast Container -->
    <div id="toastContainer" class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"></div>
`;

console.log('Writing rebuild script...');
