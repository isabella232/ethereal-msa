'use strict';

// Simple SMTP server that accepts all messages for valid recipients

const config = require('wild-config');
const log = require('npmlog');
const SMTPServer = require('smtp-server').SMTPServer;
const tools = require('wildduck/lib/tools');
const UserHandler = require('wildduck/lib/user-handler');
const MessageHandler = require('wildduck/lib/message-handler');
const db = require('./lib/db');
const fs = require('fs');

let messageHandler;
let userHandler;

const serverOptions = {
    // log to console
    logger: {
        info(...args) {
            args.shift();
            log.info('SMTP', ...args);
        },
        debug(...args) {
            args.shift();
            log.silly('SMTP', ...args);
        },
        error(...args) {
            args.shift();
            log.error('SMTP', ...args);
        }
    },

    name: false,

    // not required but nice-to-have
    banner: config.smtp.banner,

    disabledCommands: [],

    onAuth(auth, session, callback) {
        userHandler.authenticate(
            auth.username,
            auth.password,
            'smtp',
            {
                protocol: 'SMTP',
                ip: session.remoteAddress
            },
            (err, result) => {
                if (err) {
                    return callback(err);
                }
                if (!result || (result.scope === 'master' && result.require2fa)) {
                    err = new Error('Authentication failed');
                    err.responseCode = 535;
                    err.name = 'SMTPResponse'; // do not throw
                    return callback(err);
                }

                callback(null, { user: result.user });
            }
        );
    },

    onMailFrom(address, session, callback) {
        // accept alls sender addresses
        return callback();
    },

    // Validate RCPT TO envelope address. Example allows all addresses that do not start with 'deny'
    // If this method is not set, all addresses are allowed
    onRcptTo(rcpt, session, callback) {
        //accept
        callback();
    },

    // Handle message stream
    onData(stream, session, callback) {
        let chunks = [];
        let chunklen = 0;

        stream.on('readable', () => {
            let chunk;
            while ((chunk = stream.read()) !== null) {
                chunks.push(chunk);
                chunklen += chunk.length;
            }
        });

        stream.once('error', err => {
            log.error('SMTP', err);
            callback(new Error('Error reading from stream'));
        });

        stream.once('end', () => {
            let sender = tools.normalizeAddress((session.envelope.mailFrom && session.envelope.mailFrom.address) || '');
            let recipients = session.envelope.rcptTo.map(rcpt => tools.normalizeAddress(rcpt.address));

            // create Delivered-To and Received headers
            let header = Buffer.from(
                ['Return-Path: <' + (sender || '') + '>'].join('\r\n') + '\r\n'
                //+ 'Received: ' + generateReceivedHeader(session, queueId, os.hostname().toLowerCase(), recipient) + '\r\n'
            );

            chunks.unshift(header);
            chunklen += header.length;

            let raw = Buffer.concat(chunks, chunklen);

            let prepared = messageHandler.prepareMessage({
                raw
            });
            let maildata = messageHandler.indexer.getMaildata(prepared.id, prepared.mimeTree);

            // default flags are empty
            let flags = [];

            // default mailbox target is Sent Mail
            let mailboxQueryKey = 'specialUse';
            let mailboxQueryValue = '\\Sent';

            let messageOptions = {
                user: session.user,
                [mailboxQueryKey]: mailboxQueryValue,

                prepared,
                maildata,

                meta: {
                    source: 'SMTP',
                    from: sender,
                    to: recipients,
                    origin: session.remoteAddress,
                    originhost: session.clientHostname,
                    transhost: session.hostNameAppearsAs,
                    transtype: session.transmissionType,
                    time: Date.now()
                },

                filters: [],

                date: false,
                flags,

                // if similar message exists, then skip
                skipExisting: true
            };

            messageHandler.add(messageOptions, (err, inserted, info) => {
                if (err) {
                    return callback(err);
                }

                let mboxId = Buffer.from(info.mailbox.toString(), 'hex');
                let msgId = Buffer.from(info.id.toString(), 'hex');
                let uid = Buffer.alloc(6);
                uid.writeUInt32BE(info.uid, 2);

                return callback(
                    null,
                    'Accepted [STATUS=' +
                        info.status +
                        ' MSGID=' +
                        Buffer.concat([mboxId, msgId, uid]).toString('base64').replace(/\+/g, '.').replace(/\//g, ',') +
                        ']'
                );
            });
        });
    }
};

if (config.tls.key) {
    serverOptions.key = fs.readFileSync(config.tls.key);
    let ca = [].concat(config.tls.ca || []).map(path => fs.readFileSync(path));
    if (ca.length) {
        serverOptions.ca = ca;
    }
    serverOptions.cert = fs.readFileSync(config.tls.cert);
}
const server = new SMTPServer(serverOptions);

module.exports = done => {
    messageHandler = new MessageHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        gridfs: db.gridfs,
        attachments: config.attachments
    });

    userHandler = new UserHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        gridfs: db.gridfs,
        authlogExpireDays: config.log.authlogExpireDays
    });

    let started = false;

    server.on('error', err => {
        if (!started) {
            started = true;
            return done(err);
        }
        log.error('SMTP', err);
    });

    server.listen(config.smtp.port, config.smtp.host, () => {
        if (started) {
            return server.close();
        }
        started = true;
        done(null, server);
    });
};
