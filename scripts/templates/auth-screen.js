const fs = require('fs');

/**
 * AUTH SCREEN (Login, Sign Up, Email OTP Verification)
 */
function getAuthScreenHtml() {
    return `
    <!-- ============================================================== -->
    <!-- 1. AUTHENTICATION EXPERIENCE (LOGIN, SIGNUP, OTP VERIFICATION) -->
    <!-- ============================================================== -->
    <div id="authScreen" class="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-surface">
        <div class="w-full max-w-6xl min-h-[640px] flex flex-col lg:flex-row rounded-3xl overflow-hidden qw-glass shadow-2xl border border-outline-variant">
            
            <!-- LEFT FINANCIAL HERO CANVAS (Stripe & Linear Inspired) -->
            <div class="relative w-full lg:w-1/2 bg-[#090b10] p-8 sm:p-12 text-white flex flex-col justify-between overflow-hidden border-b lg:border-b-0 lg:border-r border-white/[0.08]">
                <!-- Subtle Ambient Lights & Geometric Grid -->
                <div class="absolute inset-0 bg-[radial-gradient(#ffffff0a_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none"></div>
                <div class="absolute -right-20 -top-20 w-80 h-80 rounded-full bg-emerald-500/15 blur-[100px] pointer-events-none"></div>
                <div class="absolute -left-20 bottom-10 w-80 h-80 rounded-full bg-indigo-500/15 blur-[100px] pointer-events-none"></div>

                <!-- Brand Header -->
                <div class="relative z-10 flex flex-col gap-6">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-[1px] shadow-lg shadow-emerald-500/20">
                            <div class="w-full h-full bg-[#0a0d14] rounded-[11px] flex items-center justify-center text-emerald-400">
                                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                                </svg>
                            </div>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-xl font-extrabold tracking-tight text-white flex items-center gap-1.5 font-sans">
                                SplitWise <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">PRO</span>
                            </span>
                            <span class="text-[10px] font-medium tracking-wider uppercase text-slate-400">Autonomous Financial Ledger</span>
                        </div>
                    </div>

                    <div class="mt-4 space-y-3">
                        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span>Debt Simplification Matrix Live</span>
                        </div>
                        <h1 class="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                            Shared spending, <br/><span class="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-indigo-400">effortlessly balanced.</span>
                        </h1>
                        <p class="text-sm text-slate-400 max-w-md leading-relaxed">
                            Organize group trips, shared apartments, and team expenses with graph debt minimization, instant UPI transfers, and autonomous AI bookkeeping.
                        </p>
                    </div>
                </div>

                <!-- Interactive Financial Metric Showcase -->
                <div class="relative z-10 my-8">
                    <div class="p-5 rounded-2xl bg-white/[0.03] backdrop-blur-md border border-white/10 shadow-2xl space-y-4">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold font-mono">
                                    ₹
                                </div>
                                <div>
                                    <div class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Multi-User Isolation</div>
                                    <div class="text-sm font-bold text-white">Private Circles & Ledgers</div>
                                </div>
                            </div>
                            <span class="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-xs font-mono font-semibold">
                                Active
                            </span>
                        </div>

                        <div class="p-3 rounded-xl bg-black/40 border border-white/5 space-y-2">
                            <div class="flex items-center justify-between text-xs">
                                <span class="text-slate-400 flex items-center gap-1.5">
                                    <span class="material-symbols-outlined text-[16px] text-teal-400">shield_lock</span>
                                    Protected Settlement Engine
                                </span>
                                <span class="text-emerald-400 font-mono font-bold">100% Balanced</span>
                            </div>
                            <div class="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                                <div class="bg-gradient-to-r from-emerald-400 to-teal-400 h-full rounded-full" style="width: 100%"></div>
                            </div>
                        </div>

                        <div class="flex items-center justify-between text-xs text-slate-400 pt-1 font-mono">
                            <span>0% Foreign Exchange Markup</span>
                            <span class="text-slate-200">9 Currencies Supported</span>
                        </div>
                    </div>
                </div>

                <!-- Trust Footer -->
                <div class="relative z-10 pt-4 border-t border-white/[0.08] flex items-center justify-between text-xs text-slate-400">
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                        <span>Multi-Tenant Architecture</span>
                    </div>
                    <span>End-to-End Encrypted</span>
                </div>
            </div>

            <!-- RIGHT AUTH FORM PANEL -->
            <div class="w-full lg:w-1/2 p-6 sm:p-10 lg:p-12 flex flex-col justify-center bg-surface-container-lowest">
                <div class="max-w-md w-full mx-auto space-y-6">
                    
                    <!-- 1. LOGIN / SIGNUP FORM -->
                    <div id="authFormContainer" class="space-y-6">
                        <div>
                            <h2 class="text-2xl sm:text-3xl font-extrabold text-on-surface tracking-tight" id="authHeading">Welcome back</h2>
                            <p class="text-sm text-on-surface-variant mt-1.5" id="authSubheading">Enter your credentials to access your financial circles</p>
                        </div>

                        <div id="authAlertBox" class="hidden p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs font-semibold leading-relaxed"></div>

                        <form id="authForm" onsubmit="handleAuthSubmit(event)" class="space-y-4">
                            <div id="authNameGroup" class="hidden space-y-1.5">
                                <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Full Name</label>
                                <div class="relative flex items-center">
                                    <span class="material-symbols-outlined absolute left-3.5 text-on-surface-variant text-[20px]">person</span>
                                    <input id="authName" type="text" placeholder="Enter your full name" class="qw-input pl-11"/>
                                </div>
                                <p id="authNameError" class="hidden text-xs text-rose-500 font-semibold mt-1">Please enter your name.</p>
                            </div>

                            <div class="space-y-1.5">
                                <label id="authEmailLabel" class="block text-xs font-bold text-on-surface uppercase tracking-wider">Username or Email Address</label>
                                <div class="relative flex items-center">
                                    <span class="material-symbols-outlined absolute left-3.5 text-on-surface-variant text-[20px]">badge</span>
                                    <input id="authEmail" type="text" required placeholder="alex@splitease.io or alex" autocomplete="username" class="qw-input pl-11"/>
                                </div>
                                <p id="authEmailError" class="hidden text-xs text-rose-500 font-semibold mt-1">Please enter your username or valid email address.</p>
                            </div>

                            <div class="space-y-1.5">
                                <div class="flex items-center justify-between">
                                    <label class="block text-xs font-bold text-on-surface uppercase tracking-wider">Password</label>
                                    <div id="authForgotRow">
                                        <button type="button" onclick="openForgotPasswordModal()" class="text-xs font-semibold text-primary hover:underline">
                                            Forgot password?
                                        </button>
                                    </div>
                                </div>
                                <div class="relative flex items-center">
                                    <span class="material-symbols-outlined absolute left-3.5 text-on-surface-variant text-[20px]">lock</span>
                                    <input id="authPassword" type="password" required placeholder="••••••••" class="qw-input pl-11"/>
                                </div>
                                <p id="authPasswordError" class="hidden text-xs text-rose-500 font-semibold mt-1">Password must contain at least 8 characters.</p>
                            </div>

                            <button id="authSubmitBtn" type="submit" class="qw-btn qw-btn-primary w-full py-3 text-sm font-bold shadow-md">
                                <span class="material-symbols-outlined text-[18px]">arrow_forward</span>
                                <span>Sign In to SplitWise</span>
                            </button>
                        </form>

                        <div class="pt-4 border-t border-outline-variant text-center">
                            <button onclick="toggleAuthMode()" type="button" class="text-sm font-semibold text-primary hover:underline transition-colors" id="authToggleBtn">
                                Don't have an account? Sign Up
                            </button>
                        </div>
                    </div>

                    <!-- 2. OTP VERIFICATION FORM -->
                    <div id="authOtpContainer" class="hidden space-y-6">
                        <div class="flex items-center gap-3.5">
                            <div class="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 border border-primary/20">
                                <span class="material-symbols-outlined text-[24px]">mark_email_read</span>
                            </div>
                            <div>
                                <h2 class="text-xl sm:text-2xl font-extrabold text-on-surface tracking-tight">Verify Your Email</h2>
                                <p class="text-xs text-on-surface-variant mt-0.5">We sent a 6-digit passcode to <strong id="signupOtpTargetEmail" class="text-on-surface font-semibold font-mono"></strong></p>
                            </div>
                        </div>

                        <div id="signupOtpAlertBox" class="hidden p-3.5 rounded-xl text-xs font-semibold border"></div>

                        <form id="signupOtpForm" onsubmit="handleVerifySignupOtp(event)" class="space-y-5">
                            <div>
                                <label class="block text-xs font-bold text-on-surface uppercase tracking-wider mb-2.5 text-center">Enter 6-Digit Passcode</label>
                                <div class="flex items-center justify-center gap-2 sm:gap-2.5" id="signupOtpInputGroup">
                                    <input id="signupOtp0" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" class="w-11 sm:w-12 h-13 text-center text-xl font-bold font-mono rounded-xl bg-surface-container-low border border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20 text-on-surface transition-all" autofocus />
                                    <input id="signupOtp1" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" class="w-11 sm:w-12 h-13 text-center text-xl font-bold font-mono rounded-xl bg-surface-container-low border border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20 text-on-surface transition-all" />
                                    <input id="signupOtp2" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" class="w-11 sm:w-12 h-13 text-center text-xl font-bold font-mono rounded-xl bg-surface-container-low border border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20 text-on-surface transition-all" />
                                    <input id="signupOtp3" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" class="w-11 sm:w-12 h-13 text-center text-xl font-bold font-mono rounded-xl bg-surface-container-low border border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20 text-on-surface transition-all" />
                                    <input id="signupOtp4" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" class="w-11 sm:w-12 h-13 text-center text-xl font-bold font-mono rounded-xl bg-surface-container-low border border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20 text-on-surface transition-all" />
                                    <input id="signupOtp5" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" class="w-11 sm:w-12 h-13 text-center text-xl font-bold font-mono rounded-xl bg-surface-container-low border border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20 text-on-surface transition-all" />
                                </div>
                                <p class="text-[11px] text-center text-on-surface-variant mt-2 font-mono">Code expires in 5 minutes</p>
                            </div>

                            <button id="signupVerifyBtn" type="submit" class="qw-btn qw-btn-primary w-full py-3 text-sm font-bold shadow-md">
                                <span class="material-symbols-outlined text-[18px]">verified</span>
                                <span>Verify & Create Account</span>
                            </button>
                        </form>

                        <div class="flex items-center justify-between pt-3 border-t border-outline-variant text-xs">
                            <button type="button" onclick="backToSignupForm()" class="font-semibold text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1">
                                <span class="material-symbols-outlined text-[16px]">arrow_back</span>
                                <span>Edit details</span>
                            </button>
                            <button id="signupResendBtn" type="button" onclick="handleResendSignupOtp()" class="font-bold text-primary hover:underline transition-colors disabled:opacity-50">
                                Resend in 30s
                            </button>
                        </div>
                    </div>

                </div>
            </div>

        </div>
    </div>
    `;
}

module.exports = { getAuthScreenHtml };
