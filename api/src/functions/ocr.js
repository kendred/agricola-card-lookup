const { app } = require('@azure/functions');
const { adaptV3 } = require('../v3-adapter');
const v3Handler = require('../../ocr/index');

app.http('ocr', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'ocr',
    handler: adaptV3(v3Handler),
});
