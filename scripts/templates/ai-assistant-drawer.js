/**
 * AI ASSISTANT & HANDS-FREE VOICE INTERACTION DRAWER
 * Vercel / Linear inspired floating AI assistant with soundwave visualization.
 */
function getAiAssistantDrawerHtml() {
    return `
    <!-- ============================================================== -->
    <!-- AI ASSISTANT LAUNCHER (FLOATING GLOWING ORB)                   -->
    <!-- ============================================================== -->
    <button id="chatbotLauncher" onclick="toggleChatbot()" class="fixed bottom-6 right-6 z-40 qw-btn qw-btn-primary p-3.5 rounded-full shadow-2xl flex items-center justify-center gap-2 quantum-orb-active group" title="Open SplitWise AI Copilot (Natural Voice & Text)">
        <span class="material-symbols-outlined text-[22px] transition-transform group-hover:scale-110">neurology</span>
        <span class="hidden md:inline font-mono text-xs font-bold tracking-tight">AI Copilot</span>
    </button>

    <!-- ============================================================== -->
    <!-- AI ASSISTANT DRAWER (VOICE VAD & NATURAL LANGUAGE TOOLS)       -->
    <!-- ============================================================== -->
    <div id="chatbotDrawer" class="hidden fixed inset-x-3 bottom-20 sm:bottom-24 sm:right-6 sm:left-auto sm:w-[440px] max-h-[85vh] h-[640px] qw-glass rounded-3xl shadow-2xl z-50 flex flex-col overflow-hidden border border-outline-variant quantum-modal-content">
        
        <!-- Header -->
        <div class="p-4 border-b border-outline-variant flex items-center justify-between bg-surface-container">
            <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-[1px] shadow-sm flex-shrink-0">
                    <div class="w-full h-full bg-[#0a0d14] rounded-[11px] flex items-center justify-center text-emerald-400">
                        <span class="material-symbols-outlined text-[20px]">neurology</span>
                    </div>
                </div>
                <div>
                    <div class="flex items-center gap-1.5">
                        <h3 class="text-xs font-bold text-on-surface">SplitWise Copilot</h3>
                        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    </div>
                    <span id="chatbotPromptHint" class="text-[10px] text-on-surface-variant font-mono">Ask anything or speak hands-free</span>
                </div>
            </div>

            <!-- Controls (Lang, Voice Toggle, Speech Stop, Close) -->
            <div class="flex items-center gap-1">
                <!-- Hands-Free Voice Auto-Send Toggle -->
                <button id="voiceHandsFreeToggle" onclick="toggleVoiceHandsFreeMode()" class="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant" title="Toggle Hands-Free Voice Auto-Send">
                    <span id="voiceToggleIcon" class="material-symbols-outlined text-[17px] text-emerald-500">volume_up</span>
                </button>
                <span id="voiceStatusPill" class="hidden text-[9px] font-mono font-bold text-emerald-500 px-1 py-0.2 bg-emerald-500/10 rounded">Auto-Send</span>

                <!-- Language Selector -->
                <select onchange="setChatbotLang(this.value)" class="text-[10px] font-mono bg-surface-container border border-outline-variant rounded-md px-1.5 py-0.5 text-on-surface focus:outline-none">
                    <option value="en-IN">EN</option>
                    <option value="hi-IN">HI</option>
                    <option value="gu-IN">GU</option>
                </select>

                <!-- Speech Stop Button -->
                <button id="chatbotStopSpeechBtn" onclick="stopAllChatbotAudioAndVoice()" class="hidden p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition-colors" title="Mute AI Speech">
                    <span class="material-symbols-outlined text-[17px]">volume_off</span>
                </button>

                <!-- Close Button -->
                <button onclick="toggleChatbot()" class="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors" title="Close Copilot">
                    <span class="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>
        </div>

        <!-- Audio Player Control Strip (when speaking) -->
        <div id="audioControlsStrip" class="hidden p-2 bg-primary/10 border-b border-primary/20 flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
                <span id="audioStateIcon" class="material-symbols-outlined text-[16px] text-primary">play_arrow</span>
                <span id="audioStateText" class="text-[11px] font-semibold text-primary font-mono">Speaking response...</span>
            </div>
            <div class="flex items-center gap-1">
                <button id="audioPlayBtn" onclick="resumeSpeechSynthesis()" class="p-1 rounded text-primary hover:bg-primary/20"><span class="material-symbols-outlined text-[16px]">play_arrow</span></button>
                <button id="audioPauseBtn" onclick="pauseSpeechSynthesis()" class="p-1 rounded text-primary hover:bg-primary/20"><span class="material-symbols-outlined text-[16px]">pause</span></button>
                <button id="audioResumeBtn" onclick="resumeSpeechSynthesis()" class="hidden p-1 rounded text-primary hover:bg-primary/20"><span class="material-symbols-outlined text-[16px]">play_arrow</span></button>
                <button id="audioStopBtn" onclick="stopSpeechSynthesis()" class="p-1 rounded text-rose-500 hover:bg-rose-500/20"><span class="material-symbols-outlined text-[16px]">stop</span></button>
                <button id="audioReplayBtn" onclick="replayLastSpeechSynthesis()" class="p-1 rounded text-primary hover:bg-primary/20"><span class="material-symbols-outlined text-[16px]">replay</span></button>
            </div>
        </div>

        <!-- Voice Soundwave Animation Bar (Active when user is recording speech) -->
        <div id="voiceWaveContainer" class="hidden p-3 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center justify-center gap-1.5">
            <span class="text-[11px] font-bold font-mono text-emerald-400 mr-2 flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                Listening...
            </span>
            <div class="w-1 bg-emerald-400 rounded-full voice-wave-bar"></div>
            <div class="w-1 bg-emerald-400 rounded-full voice-wave-bar"></div>
            <div class="w-1 bg-emerald-400 rounded-full voice-wave-bar"></div>
            <div class="w-1 bg-emerald-400 rounded-full voice-wave-bar"></div>
            <div class="w-1 bg-emerald-400 rounded-full voice-wave-bar"></div>
            <span class="text-[10px] text-emerald-300/80 ml-2 font-mono">Pause to auto-send</span>
        </div>

        <!-- Messages Thread -->
        <div id="chatbotMessages" class="flex-1 p-4 overflow-y-auto space-y-3 text-xs leading-relaxed">
            <!-- Messages populated dynamically -->
        </div>

        <!-- Quick Suggestion Chips -->
        <div id="chatbotQuickChips" class="px-4 py-2 border-t border-outline-variant/60 flex items-center gap-1.5 overflow-x-auto text-[11px] no-scrollbar">
            <!-- Populated dynamically -->
        </div>

        <!-- Input Bar with Hands-Free Mic Button -->
        <div class="p-3 border-t border-outline-variant bg-surface-container flex items-center gap-2">
            <button id="chatbotMicBtn" onclick="toggleVoiceRecognition()" type="button" class="w-10 h-10 rounded-xl bg-surface-container-low text-primary hover:bg-surface-container-high flex items-center justify-center transition-all flex-shrink-0" title="Click to Speak (or use Hands-Free)">
                <span class="material-symbols-outlined text-[20px]" id="chatbotMicIcon">mic</span>
            </button>
            <input id="chatbotInput" type="text" onkeydown="if(event.key==='Enter') sendChatbotMessage()" placeholder="Ask copilot or speak hands-free..." class="qw-input text-xs py-2.5 flex-1 rounded-xl"/>
            <button onclick="sendChatbotMessage()" type="button" class="qw-btn qw-btn-primary p-2.5 rounded-xl text-xs font-bold flex-shrink-0">
                <span class="material-symbols-outlined text-[17px]">send</span>
            </button>
        </div>

    </div>
    `;
}

module.exports = { getAiAssistantDrawerHtml };
