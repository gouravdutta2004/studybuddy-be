import puppeteer from 'puppeteer';
import axios from 'axios';

(async () => {
    try {
        let token;
        try {
            console.log("Logging in via API...");
            const res = await axios.post('http://localhost:5000/api/auth/login', { email: 'puppeteer@test.com', password: 'password123' });
            token = res.data.token;
            console.log("Logged in");
        } catch (e) {
            console.log("Registering via API...");
            const res2 = await axios.post('http://localhost:5000/api/auth/register', { name: "Puppeteer", email: "puppeteer@test.com", password: "password123" });
            token = res2.data.token;
            console.log("Registered");
        }
        
        const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
        const page = await browser.newPage();
        
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log('PAGE ERROR LOG:', msg.text());
            }
        });
        page.on('pageerror', err => console.log('PAGE FATAL ERROR:', err.toString()));
        
        console.log("Opening App...");
        await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
        
        await page.evaluate((t) => {
            localStorage.setItem('token', t);
        }, token);
        
        console.log("Going to dashboard...");
        await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle2' });
        
        console.log("Finished page load on dashboard");
        
        const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML?.substring(0, 500));
        console.log("ROOT DOM START:", rootHtml);
        
        await browser.close();
    } catch (e) {
        console.error(e.message);
    }
})();
