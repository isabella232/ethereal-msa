/* eslint global-require:0 */

'use strict';

process.env.UV_THREADPOOL_SIZE = 16;

const config = require('wild-config');
const packageData = require('./package.json');
const log = require('npmlog');

log.level = config.log.level;
require('./logger');

const printLogo = () => {
    let versionString = ' ' + packageData.name + '@' + packageData.version + ' ';

    log.info('App', '');
    log.info('App', versionString);
    log.info('App', '');
};

if (!config.processes || config.processes <= 1) {
    printLogo();
    if (config.ident) {
        process.title = config.ident;
    }
    // single process mode, do not fork anything
    require('./worker.js');
} else {
    let cluster = require('cluster');

    if (cluster.isMaster) {
        printLogo();

        if (config.ident) {
            process.title = config.ident + ' master';
        }

        log.info('App', `Master [${process.pid}] is running`);

        let forkWorker = () => {
            let worker = cluster.fork();
            log.info('App', `Forked worker ${worker.process.pid}`);
        };

        // Fork workers.
        for (let i = 0; i < config.processes; i++) {
            forkWorker();
        }

        cluster.on('exit', worker => {
            log.info('App', `Worker ${worker.process.pid} died`);
            setTimeout(forkWorker, 1000);
        });
    } else {
        if (config.ident) {
            process.title = config.ident + ' worker';
        }

        require('./worker.js');
    }
}
