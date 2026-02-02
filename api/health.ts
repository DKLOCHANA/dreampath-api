import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    return res.status(200).json({
        status: 'ok',
        service: 'DreamPath API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
    });
}
