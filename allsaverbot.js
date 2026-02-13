// === CONFIGURATION ===
const BOT_TOKEN = '8242688270:AAG4fUWUhfT5gKt9U6KJqNqbut-1B2hwUaY';
const API_BASE_URL = 'https://api-spyl.onrender.com/download?url=';

// Memory
const lastRequestTime = new Map();  
const activeProcessing = new Set(); 
let lastUpdateId = 0;               

// Escape HTML
function escapeHTML(str = "") {
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
}

// Telegram API request
async function tg(method, body) {
    return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

export default {
    async fetch(request, env, ctx) {
        if (request.method !== 'POST') {
            return new Response('🤖 Bot Status: Active', { status: 200 });
        }

        try {
            const update = await request.json();
            if (update.update_id <= lastUpdateId) return new Response('OK');
            lastUpdateId = update.update_id;

            const message = update.message;
            if (!message || !message.text) return new Response('OK');

            const chatId = message.chat.id;
            const text = message.text.trim();

            if (text.startsWith('/start')) {
                await tg('sendMessage', {
                    chat_id: chatId,
                    text: `<b>🚀 Fast Instagram Downloader</b>\n\nSend me a Reel link and I'll send the video instantly!\n\n✨ <b>High Speed • No Watermarks</b>`,
                    parse_mode: 'HTML'
                });
                return new Response('OK');
            }

            if (text.includes('instagram.com')) {
                const now = Date.now();
                const lastTime = lastRequestTime.get(chatId) || 0;
                const cooldown = 10000; 

                if (activeProcessing.has(chatId) || (now - lastTime < cooldown)) {
                    await tg('sendMessage', {
                        chat_id: chatId,
                        text: `⏳ <b>Slow down!</b> Please wait 10 seconds.`,
                        parse_mode: 'HTML'
                    });
                    return new Response('OK');
                }

                lastRequestTime.set(chatId, now);
                activeProcessing.add(chatId);
                ctx.waitUntil(handleDownload(chatId, text));
                return new Response('OK');
            }
        } catch (err) {
            console.error(err);
        }
        return new Response('OK');
    }
};

// --- DOWNLOAD HANDLER ---
async function handleDownload(chatId, url) {
    let loadingMsgId = null;

    try {
        const statusRes = await tg('sendMessage', {
            chat_id: chatId,
            text: '⚡ <b>Downloading...</b>',
            parse_mode: 'HTML'
        });
        const statusData = await statusRes.json();
        loadingMsgId = statusData.result?.message_id;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        let apiRes;
        try {
            apiRes = await fetch(API_BASE_URL + encodeURIComponent(url), { signal: controller.signal });
        } catch (err) {
            throw new Error("API Timeout");
        } finally {
            clearTimeout(timeout);
        }

        const data = await apiRes.json();
        if (data.status !== 'success' || !data.download_url) {
            throw new Error("API Fail");
        }

        // --- CAPTION LOGIC (A2Z FIX) ---
        const fullCaption = data.caption || "";
        const escapedCaption = escapeHTML(fullCaption);
        
        // Telegram video caption limit is 1024
        const captionForVideo = escapedCaption.slice(0, 1020);
        const remainingCaption = escapedCaption.slice(1020);

        // 3. Send Video
        const videoRes = await tg('sendVideo', {
            chat_id: chatId,
            video: data.download_url,
            caption: captionForVideo + (remainingCaption ? "..." : ""),
            parse_mode: 'HTML',
            supports_streaming: true
        });

        const videoResult = await videoRes.json();

        if (!videoResult.ok) {
            await tg('sendMessage', {
                chat_id: chatId,
                text: `⚠️ <b>File too large!</b>\n📥 <a href="${data.download_url}"><b>Download Link</b></a>`,
                parse_mode: 'HTML'
            });
        } else if (remainingCaption) {
            // AGAR CAPTION BACH GAYA HAI TO ALAG SE BHEJO (Full Text)
            await tg('sendMessage', {
                chat_id: chatId,
                text: `<b>📝 Continued Caption:</b>\n\n${escapedCaption}`,
                parse_mode: 'HTML'
            });
        }

    } catch (err) {
        await tg('sendMessage', {
            chat_id: chatId,
            text: '❌ <b>Error:</b> Could not process link.',
            parse_mode: 'HTML'
        });
    } finally {
        if (loadingMsgId) {
            await tg('deleteMessage', { chat_id: chatId, message_id: loadingMsgId });
        }
        activeProcessing.delete(chatId);
    }
}
