const { app } = require('@azure/functions');
const { adaptV3 } = require('../v3-adapter');
const v3Handler = require('../../submit-card/index');

app.http('submitCard', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'submit-card',
    handler: adaptV3(v3Handler),
});
