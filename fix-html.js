import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const walk = (dir, done) => {
    let results = [];
    fs.readdir(dir, (err, list) => {
        if (err) return done(err);
        let pending = list.length;
        if (!pending) return done(null, results);
        list.forEach(file => {
            file = path.resolve(dir, file);
            fs.stat(file, (err, stat) => {
                if (stat && stat.isDirectory() && !file.includes('node_modules') && !file.includes('.git')) {
                    walk(file, (err, res) => {
                        results = results.concat(res);
                        if (!--pending) done(null, results);
                    });
                } else {
                    if (file.endsWith('.html') || file.endsWith('.js') || file.endsWith('.css') || file.endsWith('.json')) {
                        results.push(file);
                    }
                    if (!--pending) done(null, results);
                }
            });
        });
    });
};

const replacements = [
    { p: /Quantum\s*<[^>]+>\s*Chem\s*(<\/[^>]+>)?/gi, r: 'Classgrid' },
    { p: /Quantum\s*Chem(istry)?/gi, r: 'Classgrid' },
    { p: /data-theme="classgrid"/gi, r: 'data-theme="classgrid"' },
    { p: /\[data-theme="classgrid"\]/gi, r: '[data-theme="classgrid"]' },
    { p: /setTheme\('quantum'/gi, r: "setTheme('classgrid'" },
    { p: /theme === 'classgrid'/gi, r: "theme === 'classgrid'" },
    { p: /\|\| 'quantum'/gi, r: "|| 'classgrid'" },
    { p: /Classgrid Dark/gi, r: 'Classgrid Dark' },
    { p: /\.classgrid-loader/gi, r: '.classgrid-loader' },
    { p: /\.classgrid-container/gi, r: '.classgrid-container' },
    { p: /\.classgrid-header/gi, r: '.classgrid-header' },
    { p: /\.classgrid-footer/gi, r: '.classgrid-footer' },
    { p: /class="classgrid-loader"/gi, r: 'class="classgrid-loader"' },
    { p: /id="classgridLoader"/gi, r: 'id="classgridLoader"' },
    { p: /class="classgrid-container"/gi, r: 'class="classgrid-container"' },
    { p: /id="classgridContainer"/gi, r: 'id="classgridContainer"' },
    { p: /class="classgrid-header"/gi, r: 'class="classgrid-header"' },
    { p: /class="classgrid-footer"/gi, r: 'class="classgrid-footer"' },
    { p: /'classgridLoader'/gi, r: "'classgridLoader'" },
    { p: /'classgridContainer'/gi, r: "'classgridContainer'" },
    { p: /Classgrid<\/span>/gi, r: 'Classgrid' },
    { p: /Quantum\s*<span[^>]*>\s*Chem\s*<\/span>/gi, r: 'Classgrid' },
    { p: /Classgrid<\/em>/gi, r: 'Classgrid' }
];

walk(__dirname, (err, files) => {
    if (err) throw err;
    let modifiedFiles = 0;
    files.forEach(file => {
        if (file.includes('node_modules') || file.includes('.git')) return;
        let content = fs.readFileSync(file, 'utf8');
        let original = content;

        // Custom manual HTML replacements
        content = content.replace(/Quantum\s*<span[^>]*>\s*Chem\s*<\/span>/gi, 'Classgrid');
        content = content.replace(/Quantum\s*<em[^>]*>\s*Chem\s*<\/em>/gi, 'Classgrid');
        content = content.replace(/Quantum\s*<span[^>]*>\s*(.*?)Chem\s*<\/span>/gi, 'Classgrid'); // if there is stuff inside span

        replacements.forEach(rep => {
            content = content.replace(rep.p, rep.r);
        });

        if (content !== original) {
            fs.writeFileSync(file, content);
            modifiedFiles++;
            console.log('Modified:', path.relative(__dirname, file));
        }
    });
    console.log(`Total files modified: ${modifiedFiles}`);
});
