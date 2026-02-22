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
                if (stat && stat.isDirectory()) {
                    walk(file, (err, res) => {
                        results = results.concat(res);
                        if (!--pending) done(null, results);
                    });
                } else {
                    if (file.endsWith('.js') || file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.json')) {
                        results.push(file);
                    }
                    if (!--pending) done(null, results);
                }
            });
        });
    });
};

const replacements = [
    { p: /&\s*Research\s*Platform/gi, r: '' },
    { p: /Research\s*Platform/gi, r: 'Platform' },
    { p: /research\s*platform/gi, r: 'platform' },
    { p: /researchers/gi, r: 'educators' },
    { p: /Researchers/gi, r: 'Educators' },
    { p: /researcher/gi, r: 'educator' },
    { p: /Researcher/gi, r: 'Educator' },
    { p: /research/gi, r: 'study' },
    { p: /Research/gi, r: 'Study' },
    { p: /chemistry\s*assistant/gi, r: 'learning assistant' },
    { p: /Chemistry\s*Assistant/gi, r: 'Learning Assistant' },
    { p: /chemistry\s*education/gi, r: 'science education' },
    { p: /Chemistry\s*Education/gi, r: 'Science Education' },
    { p: /chemistry\s*platform/gi, r: 'learning platform' },
    { p: /Chemistry\s*Platform/gi, r: 'Learning Platform' },
    { p: /chemistry\s*mentor/gi, r: 'mentor' },
    { p: /Chemistry\s*Mentor/gi, r: 'Mentor' },
    { p: /chemistry/gi, r: 'science' },
    { p: /Chemistry/g, r: 'Science' },
    { p: /chemical\s*database/gi, r: 'knowledge base' },
    { p: /Chemical\s*Database/gi, r: 'Knowledge Base' },
    { p: /chemical\s*compounds/gi, r: 'academic topics' },
    { p: /Chemical\s*Compounds/gi, r: 'Academic Topics' },
    { p: /chemical\s*compound/gi, r: 'academic topic' },
    { p: /Chemical\s*Compound/gi, r: 'Academic Topic' },
    { p: /chemicals/gi, r: 'resources' },
    { p: /Chemicals/gi, r: 'Resources' },
    { p: /chemical\s*data/gi, r: 'academic data' },
    { p: /Chemical\s*Data/gi, r: 'Academic Data' },
    { p: /chemical/gi, r: 'educational' },
    { p: /Chemical/gi, r: 'Educational' },
    { p: /Classgrid\.site/gi, r: 'classgrid.in' },
    { p: /Classgrid/gi, r: 'classgrid' },
    { p: /Classgrid/g, r: 'Classgrid' },
    { p: /Classgrid/g, r: 'Classgrid' }
];

const paths = [path.join(__dirname, 'public'), path.join(__dirname, 'src'), path.join(__dirname, 'scripts')];

let totalFiles = 0;
let modifiedFiles = 0;

paths.forEach(dir => {
    walk(dir, (err, files) => {
        if (err) throw err;
        files.forEach(file => {
            let content = fs.readFileSync(file, 'utf8');
            let newContent = content;
            replacements.forEach(rep => {
                newContent = newContent.replace(rep.p, rep.r);
            });
            if (content !== newContent) {
                fs.writeFileSync(file, newContent);
                modifiedFiles++;
                console.log('Modified:', path.relative(__dirname, file));
            }
            totalFiles++;
        });
        console.log(`Finished processing ${dir}. Files changed. Total matched so far: ${modifiedFiles}`);
    });
});
