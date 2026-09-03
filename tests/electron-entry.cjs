// Test-only launcher: never included in the distributed application.
const { app } = require('electron');
const path = require('node:path');
if (!process.env.QA_USER_DATA) throw new Error('QA_USER_DATA required');
app.setPath('userData', path.resolve(process.env.QA_USER_DATA));
require('../main');
