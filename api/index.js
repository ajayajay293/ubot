const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const API_ID = 31639742;
const API_HASH = '7c24cdee5f2b98ad27b0b8f0a07e566a';

// Simple in-memory storage (gunakan Redis di production)
const sessions = new Map();

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    
    const { path } = req.query;
    
    try {
        if (path === 'send-code') {
            const { phoneNumber } = req.body;
            
            const stringSession = new StringSession('');
            const client = new TelegramClient(stringSession, API_ID, API_HASH, {
                connectionRetries: 5,
            });
            
            await client.connect();
            const result = await client.sendCode({
                apiId: API_ID,
                apiHash: API_HASH,
                phoneNumber: phoneNumber,
            });
            
            const sessionId = Math.random().toString(36).substring(7);
            sessions.set(sessionId, {
                client,
                phoneNumber,
                phoneCodeHash: result.phoneCodeHash,
                stringSession
            });
            
            // Set cookie manually for serverless
            res.setHeader('Set-Cookie', `sessionId=${sessionId}; HttpOnly; Path=/; Max-Age=3600`);
            
            return res.json({ success: true, sessionId });
        }
        
        if (path === 'verify-code') {
            const { code, password } = req.body;
            const sessionId = req.headers.cookie?.match(/sessionId=([^;]+)/)?.[1];
            
            if (!sessionId || !sessions.has(sessionId)) {
                return res.status(400).json({ error: 'Session expired' });
            }
            
            const session = sessions.get(sessionId);
            const { client, phoneNumber, phoneCodeHash } = session;
            
            try {
                await client.invoke({
                    _: 'auth.signIn',
                    phoneNumber: phoneNumber,
                    phoneCodeHash: phoneCodeHash,
                    phoneCode: code,
                });
                
                const user = await client.getMe();
                const sessionString = client.session.save();
                
                await client.disconnect();
                sessions.delete(sessionId);
                
                // Set auth cookie
                res.setHeader('Set-Cookie', `auth=true; Path=/; Max-Age=86400`);
                
                return res.json({
                    success: true,
                    user: {
                        id: user.id,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        username: user.username,
                        phone: user.phone
                    }
                });
                
            } catch (error) {
                if (error.errorMessage === 'SESSION_PASSWORD_NEEDED') {
                    return res.status(401).json({ requirePassword: true });
                }
                throw error;
            }
        }
        
        if (path === 'me') {
            // Check auth
            const isAuth = req.headers.cookie?.includes('auth=true');
            if (!isAuth) return res.status(401).json({ error: 'Unauthorized' });
            
            return res.json({ user: { firstName: 'User', id: '12345' } }); // Simplified
        }
        
        res.status(404).json({ error: 'Not found' });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};
