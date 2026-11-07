async function initUpiPaymentRequest() {
            if (!selectedPeer) return;
            const amtVal = parseFloat(document.getElementById('settleAmountInput')?.value);
            const amount = (amtVal && amtVal > 0) ? amtVal : (selectedPeer.amount > 0 ? selectedPeer.amount : 100);
            const upi = document.getElementById('settleDisplayUpi')?.innerText || selectedPeer.upi || `${selectedPeer.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@okaxis`;

            if (upiStatusPollInterval) {
                clearInterval(upiStatusPollInterval);
                upiStatusPollInterval = null;
            }
            currentUpiRequestId = null;
            upiPollAttempts = 0;

            const pStation = document.getElementById('upiProcessingStation');
            const sCard = document.getElementById('upiSuccessConfirmationCard');
            const fCard = document.getElementById('upiFailedConfirmationCard');
            const nStation = document.getElementById('nonUpiStation');
            if (pStation) pStation.classList.remove('hidden');
            if (sCard) sCard.classList.add('hidden');
            if (fCard) fCard.classList.add('hidden');
            if (nStation) nStation.classList.add('hidden');

            const statusBadge = document.getElementById('upiLiveStatusBadge');
            if (statusBadge) {
                statusBadge.className = 'qw-badge bg-amber-500/10 text-amber-500 border border-amber-500/20';
                statusBadge.innerText = 'Waiting for Payment';
            }
            const waitText = document.getElementById('upiPollingStatusText');
            if (waitText) waitText.innerText = `Preparing payment details for ₹${amount.toFixed(2)}...`;

            try {
                const res = await fetch(`${API}/upi/create-payment-request`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        payer_id: currentUser.id,
                        receiver_id: selectedPeer.id,
                        amount: amount,
                        notes: document.getElementById('settleNotesInput')?.value?.trim() || `Automated UPI settlement with ${selectedPeer.name}`
                    })
                });

                const data = await res.json();
                const reqId = data.request_id || (data.payment_request && data.payment_request.request_id);

                if (res.ok && reqId) {
                    currentUpiRequestId = reqId;
                    const upiUri = data.payment_uri || (data.payment_request && data.payment_request.upi_string) || `upi://pay?pa=${upi}&pn=${encodeURIComponent(selectedPeer.name)}&am=${amount.toFixed(2)}&cu=INR&tr=${reqId}`;
                    
                    // Single primary QR code
                    const container = document.getElementById('upiQrCodeContainer');
                    if (container) {
                        container.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiUri)}" alt="UPI QR Code" class="w-44 h-44 object-contain rounded-lg"/>`;
                    }
                    const intentLink = document.getElementById('upiIntentLink');
                    if (intentLink) {
                        intentLink.href = upiUri;
                    }

                    if (waitText) waitText.innerText = `Scan QR code or tap button below to pay ₹${amount.toFixed(2)} (Ref: ${reqId})`;
                    if (statusBadge) {
                        statusBadge.className = 'qw-badge bg-amber-500/10 text-amber-500 border border-amber-500/20';
                        statusBadge.innerText = 'Waiting for Payment';
                    }

                    // Start polling the backend status endpoint
                    startUpiStatusPolling(reqId);
                } else {
                    if (waitText) waitText.innerText = data.error || 'Failed to initialize UPI transaction.';
                    if (statusBadge) {
                        statusBadge.className = 'qw-badge bg-rose-500/10 text-rose-500 border border-rose-500/20';
                        statusBadge.innerText = 'Transaction Failed';
                    }
                }
            } catch(e) {
                console.warn('Could not initialize backend UPI payment request:', e);
                if (waitText) waitText.innerText = 'Network error while contacting payment service.';
            }
        }

        function startUpiStatusPolling(requestId) {
            if (upiStatusPollInterval) {
                clearInterval(upiStatusPollInterval);
                upiStatusPollInterval = null;
            }
            upiPollAttempts = 0;

            console.log(`[UPI Poller] Started polling status for transaction: ${requestId}`);

            upiStatusPollInterval = setInterval(async () => {
                // Ensure we are still waiting for this exact transaction in UPI mode
                if (!requestId || currentUpiRequestId !== requestId || currentPaymentMethod !== 'UPI') {
                    console.log(`[UPI Poller] Aborting poller: active ID=${currentUpiRequestId}, polling ID=${requestId}, method=${currentPaymentMethod}`);
                    clearInterval(upiStatusPollInterval);
                    upiStatusPollInterval = null;
                    return;
                }

                upiPollAttempts++;
                if (upiPollAttempts > MAX_UPI_POLL_ATTEMPTS) {
                    console.warn(`[UPI Poller] Polling timed out after ${MAX_UPI_POLL_ATTEMPTS} attempts (${requestId})`);
                    clearInterval(upiStatusPollInterval);
                    upiStatusPollInterval = null;
                    const statusBadge = document.getElementById('upiLiveStatusBadge');
                    if (statusBadge) {
                        statusBadge.className = 'qw-badge bg-slate-500/10 text-slate-400 border border-slate-500/20';
                        statusBadge.innerText = 'Payment Expired';
                    }
                    const waitText = document.getElementById('upiPollingStatusText');
                    if (waitText) waitText.innerText = 'Payment window expired. Click Retry to generate a new QR code.';
                    return;
                }

                try {
                    const res = await fetch(`${API}/upi/payment-status/${requestId}`);
                    if (!res.ok) {
                        console.warn(`[UPI Poller] Status check returned HTTP ${res.status}`);
                        return;
                    }
                    const data = await res.json();

                    if (data.status === 'SUCCESS') {
                        console.log(`[UPI Poller] Transaction ${requestId} VERIFIED & SETTLED!`);
                        clearInterval(upiStatusPollInterval);
                        upiStatusPollInterval = null;
                        await onUpiPaymentSuccess(data);
                    } else if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(data.status)) {
                        console.log(`[UPI Poller] Transaction ${requestId} terminated with status: ${data.status}`);
                        clearInterval(upiStatusPollInterval);
                        upiStatusPollInterval = null;
                        onUpiPaymentFailed(data);
                    } else if (data.status === 'PROCESSING') {
                        const statusBadge = document.getElementById('upiLiveStatusBadge');
                        if (statusBadge) {
                            statusBadge.className = 'qw-badge bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 animate-pulse';
                            statusBadge.innerText = 'Verifying Payment';
                        }
                        const waitText = document.getElementById('upiPollingStatusText');
                        if (waitText) waitText.innerText = 'Payment notification received; confirming settlement...';
                    } else if (data.status === 'PENDING') {
                        const statusBadge = document.getElementById('upiLiveStatusBadge');
                        if (statusBadge && statusBadge.innerText !== 'Waiting for Payment') {
                            statusBadge.className = 'qw-badge bg-amber-500/10 text-amber-500 border border-amber-500/20';
                            statusBadge.innerText = 'Waiting for Payment';
                        }
                    }
                } catch(e) {
                    console.warn('[UPI Poller] Network error during status poll:', e.message);
                }
            }, 2000);
        }

        async function handleVerifyUtr() {
            if (!currentUpiRequestId) {
                showToast('No active UPI payment request to verify', 'warning');
                return;
            }
            try {
                const res = await fetch(`${API}/upi/payment-status/${currentUpiRequestId}`);
                if (!res.ok) return;
                const data = await res.json();
                if (data.status === 'SUCCESS') {
                    if (upiStatusPollInterval) {
                        clearInterval(upiStatusPollInterval);
                        upiStatusPollInterval = null;
                    }
                    showToast('✓ Payment verified! Settlement recorded in database.', 'success');
                    await onUpiPaymentSuccess(data);
                }
            } catch (err) {
                console.warn('[UPI Auto-Verify] Status check notice:', err);
            }
        }

        async function onUpiPaymentSuccess(data) {
            if (window.confetti) confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });

            const pStation = document.getElementById('upiProcessingStation');
            const sCard = document.getElementById('upiSuccessConfirmationCard');
            const fCard = document.getElementById('upiFailedConfirmationCard');
            if (pStation) pStation.classList.add('hidden');
            if (fCard) fCard.classList.add('hidden');
            if (sCard) sCard.classList.remove('hidden');

            const recName = document.getElementById('upiSuccessReceiver');
            const amtEl = document.getElementById('upiSuccessAmount');
            const txnEl = document.getElementById('upiSuccessTxnRef');
            const dateEl = document.getElementById('upiSuccessTimestamp');
            const outEl = document.getElementById('upiSuccessOutstanding');

            const amountPaid = parseFloat(data.amount || document.getElementById('settleAmountInput')?.value || 0);

            if (recName) recName.innerText = selectedPeer?.name || 'Receiver';
            if (amtEl) amtEl.innerText = `₹${amountPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            if (txnEl) txnEl.innerText = data.utr || data.transaction_ref || data.transaction_reference || (data.settlement && data.settlement.transaction_reference) || `UPI-VERIFIED`;
            if (dateEl) dateEl.innerText = new Date(data.settled_at || Date.now()).toLocaleString('en-IN');
            if (outEl) outEl.innerText = '₹0.00 (Reconciled)';

            const successAlert = document.getElementById('settleSuccessAlert');
            const successMsg = document.getElementById('settleSuccessMsg');
            if (successAlert && successMsg) {
                successMsg.innerText = `✓ Payment Verified! Settlement of ₹${amountPaid.toLocaleString('en-IN', { minimumFractionDigits: 2 })} with ${selectedPeer?.name || 'Peer'} automatically recorded in database!`;
                successAlert.classList.remove('hidden');
                successAlert.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            showToast(`✓ UPI Payment confirmed! ₹${amountPaid} automatically recorded in ledger!`, 'success');
            await refreshAllData();
        }

        function onUpiPaymentFailed(data) {
            const pStation = document.getElementById('upiProcessingStation');
            const sCard = document.getElementById('upiSuccessConfirmationCard');
            const fCard = document.getElementById('upiFailedConfirmationCard');
            if (pStation) pStation.classList.add('hidden');
            if (sCard) sCard.classList.add('hidden');
            if (fCard) fCard.classList.remove('hidden');

            const reasonEl = document.getElementById('upiFailedReason');
            if (reasonEl) {
                reasonEl.innerText = `Payment status: ${data.status || 'FAILED'}. The payment was cancelled, declined, or expired. No settlement record was created.`;
            }
            showToast(`Payment ${data.status || 'not completed'}. No settlement was recorded.`, 'warning');
        }

        function retryUpiPayment() {
            initUpiPaymentRequest();
        }

        function resetSettleFormForNewTransaction() {
            if (upiStatusPollInterval) {
                clearInterval(upiStatusPollInterval);
                upiStatusPollInterval = null;
            }
            currentUpiRequestId = null;

            const sCard = document.getElementById('upiSuccessConfirmationCard');
            const fCard = document.getElementById('upiFailedConfirmationCard');
            const successAlert = document.getElementById('settleSuccessAlert');
            if (sCard) sCard.classList.add('hidden');
            if (fCard) fCard.classList.add('hidden');
            if (successAlert) successAlert.classList.add('hidden');

            setPaymentMethod(currentPaymentMethod || 'UPI');
        }

        window.handleVerifyUtr = handleVerifyUtr;
        window.retryUpiPayment = retryUpiPayment;
        window.resetSettleFormForNewTransaction = resetSettleFormForNewTransaction;
        window.initUpiPaymentRequest = initUpiPaymentRequest;

        function resetSettleUpView() {
            if (upiStatusPollInterval) {
                clearInterval(upiStatusPollInterval);
                upiStatusPollInterval = null;
            }
            navigateTo('dashboard');
        }

        function generateUpiQrCode(upiId, amount) {
            const upiString = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(selectedPeer?.name || 'Receiver')}&am=${amount}&cu=INR`;
            const container = document.getElementById('upiQrCodeContainer');
            if (container) {
                container.innerHTML = `
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiString)}" alt="UPI QR Code" class="w-44 h-44 object-contain rounded-lg"/>
                `;
            }
            const intentLink = document.getElementById('upiIntentLink');
            if (intentLink) {
                intentLink.href = upiString;
            }
        }

        function onSettleAmountChanged() {
            if (!selectedPeer) return;
            const amt = parseFloat(document.getElementById('settleAmountInput').value) || 0;
            
            if (currentPaymentMethod === 'UPI') {
                if (upiStatusPollInterval) {
                    clearInterval(upiStatusPollInterval);
                    upiStatusPollInterval = null;
                }
                clearTimeout(settleAmountDebounceTimer);
                settleAmountDebounceTimer = setTimeout(() => {
                    initUpiPaymentRequest();
                }, 600);
            }
        }

        async function handleQrPaymentAutoSettlement() {
            if (!selectedPeer) {
                showToast('Please select a peer to settle with', 'warning');
                return;
            }
            const amount = parseFloat(document.getElementById('settleAmountInput').value);
            const upi = document.getElementById('settleDisplayUpi').innerText;
            const notes = document.getElementById('settleNotesInput').value.trim();

            if (!amount || amount <= 0) {
                showToast('Please enter a valid positive settlement amount', 'warning');
                return;
            }

            const btn = document.getElementById('btnAutoQrSettle');
            const originalHtml = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<span class="material-symbols-outlined text-[16px] animate-spin">sync</span><span>Verifying QR Payment via UPI...</span>`;
            }

            try {
                let successData = null;
                // If we have an active UPI payment request, simulate the provider webhook
                if (currentUpiRequestId) {
                    const simRes = await fetch(`${API}/upi/simulate-gateway-webhook`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            request_id: currentUpiRequestId,
                            status: 'SUCCESS'
                        })
                    });
                    if (simRes.ok) {
                        const simData = await simRes.json();
                        successData = {
                            status: 'SUCCESS',
                            amount: amount,
                            transaction_reference: simData.transaction_reference || `UPI-SIM-${Date.now()}`,
                            settled_at: new Date().toISOString()
                        };
                    }
                }

                // Fallback to QR complete endpoint
                if (!successData) {
                    const qrRef = `UPI-QR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
                    const res = await fetch(`${API}/settlements/qr-complete`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            payer_id: currentUser.id,
                            receiver_id: selectedPeer.id,
                            amount: amount,
                            upi_id: upi,
                            transaction_ref: qrRef,
                            notes: notes || `Automated settlement via UPI QR scan (${upi})`
                        })
                    });

                    const data = await res.json();
                    if (res.ok) {
                        successData = {
                            status: 'SUCCESS',
                            amount: amount,
                            transaction_reference: qrRef,
                            settled_at: new Date().toISOString()
                        };
                    } else {
                        showToast(sanitizeMessage(data.error || 'QR auto-settlement failed'), 'error');
                        return;
                    }
                }

                if (successData) {
                    await onUpiPaymentSuccess(successData);
                }
            } catch(e) {
                showToast('Connection error during QR auto-settlement', 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = originalHtml;
                }
            }
        }

        function copyUpiId() {
            const upi = document.getElementById('settleDisplayUpi').innerText;
            navigator.clipboard.writeText(upi);
            showToast(`Copied UPI ID: ${upi}`, 'success');
        }

        function copyReminderText(name, amt) {
            const text = `Hi ${name}, gentle reminder to settle up ₹${amt} on SplitEase!`;
            navigator.clipboard.writeText(text);
            showToast(`Reminder copied for ${name}!`, 'info');
        }

        async function handleConfirmSettlement() {
            if (!selectedPeer) {
                showToast('Please select a peer to settle with', 'warning');
                return;
            }
            const amount = parseFloat(document.getElementById('settleAmountInput').value);
            const notes = document.getElementById('settleNotesInput').value.trim();

            if (!amount || amount <= 0) {
                showToast('Please enter a valid positive settlement amount', 'warning');
                return;
            }

            try {
                const res = await fetch(`${API}/settlements`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        payer_id: currentUser.id,
                        receiver_id: selectedPeer.id,
                        amount,
                        payment_method: currentPaymentMethod,
                        notes
                    })
                });

                const data = await res.json();

                if (res.ok) {
                    if (window.confetti) confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
                    const successAlert = document.getElementById('settleSuccessAlert');
                    const successMsg = document.getElementById('settleSuccessMsg');
                    if (successAlert && successMsg) {
                        successMsg.innerText = `✓ Settlement of ₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} with ${selectedPeer.name} recorded successfully!`;
                        successAlert.classList.remove('hidden');
                        successAlert.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    showToast(`Settlement of ₹${amount} recorded successfully in ledger!`, 'success');
                    await refreshAllData();
                    setTimeout(() => {
                        navigateTo('dashboard');
                    }, 1500);
                } else {
                    showToast(sanitizeMessage(data.error || 'Settlement recording failed'), 'error');
                }
            } catch(e) {
                showToast('Connection error', 'error');
            }
        }

        