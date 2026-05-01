const { app } = require('@azure/functions');
const { adaptV3 } = require('../v3-adapter');
const v3Handler = require('../../draft/index');

app.http('draft', {
    methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'draft/{action?}/{id?}',
    handler: adaptV3(v3Handler),
});
