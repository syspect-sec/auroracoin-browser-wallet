/**
 * wallet.js
 * Copyright (c) 2014 Andrew Toth
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the MIT license.
 *
 * Wallet handles the address, private key and encryption,
 * as well as sending and determining balance
 */

(function (window) {
    var balance = 0,
        address = '',
        privateKey = '',
        isEncrypted = false,
        websocket = null,
        balanceListener = null;

    var wallet = function () {};
    wallet.prototype = {

        getAddress: function () {
            return address;
        },

        getBalance: function () {
            return balance;
        },

        isEncrypted: function () {
            return isEncrypted;
        },

        // Balance listener gets called with new balance whenever it updates
        setBalanceListener: function (listener) {
            balanceListener = listener;
        },

        // Create a new address
        generateAddress: function (password) {
            return new Promise(function (resolve, reject) {
                if (ret.validatePassword(password)) {
                    //must change this code 
                    var eckey = bitcoin.ECKey.makeRandom()
                    if (isEncrypted) {
                        if (typeof chrome !== 'undefined') {
                            privateKey = CryptoJS.AES.encrypt(eckey.toWIF(), password);
                        } else {
                            privateKey = JSON.parse(CryptoJS.AES.encrypt(eckey.toWIF(), password,{format:jsonFormatter}));
                        }
                    } else {
                        privateKey = eckey.toWIF();
                    }
                    address = eckey.pub.getAddress().toString();
                    balance = 0;
                    Promise.all([preferences.setAddress(address), preferences.setPrivateKey(privateKey), preferences.setIsEncrypted(isEncrypted)]).then(function () {
                        updateBalance()
                        resolve();
                    });
                } else {
                    reject(Error('Incorrect password'));
                }
            });
        },

        // Restore the previously saved address
        restoreAddress: function () {
            return new Promise(function (resolve, reject) {
                Promise.all([preferences.getAddress(), preferences.getPrivateKey(), preferences.getIsEncrypted()]).then(function (values) {
                    if (values[0].length > 0) {
                        address = values[0];
                        privateKey = values[1];
                        isEncrypted = values[2];
                        updateBalance();
                        resolve();
                    } else {
                        reject(Error('No address'));
                    }
                });
            });
        },

        // Import an address using a private key
        importAddress: function (password, _privateKey) {
            return new Promise(function (resolve, reject) {
                if (ret.validatePassword(password)) {
                    try {
                        
                        //create an ECKey from private key
                        var eckey = new bitcoin.ECKey.fromWIF(_privateKey);
                        if (isEncrypted) {
                            if (typeof chrome !== 'undefined') {
                                privateKey = CryptoJS.AES.encrypt(eckey.toWIF(), password);
                            } else {
                                privateKey = JSON.parse(CryptoJS.AES.encrypt(eckey.toWIF(), password,{format:jsonFormatter}));
                            }
                        } else {
                            privateKey = eckey.toWIF();
                        }
                        address = eckey.pub.getAddress().toString();
                        balance = 0;
                        Promise.all([preferences.setAddress(address), preferences.setPrivateKey(privateKey), preferences.setLastBalance(0)]).then(function () {
                            updateBalance();
                            resolve();
                        });
                    } catch (e) {
                        reject(Error('Invalid private key'));
                    }
                } else {
                    reject(Error('Incorrect password'));
                }
            });
        },

        // Check if the password is valid
        validatePassword: function (password) {
            if (isEncrypted) {
                try {
                    // If we can decrypt the private key with the password, then the password is correct
                    // We never store a copy of the password anywhere
                    if (typeof chrome !== 'undefined') {
                        return CryptoJS.AES.decrypt(privateKey, password).toString(CryptoJS.enc.Utf8);
                    } else {
                        return CryptoJS.AES.decrypt(JSON.stringify(privateKey), password, {format:jsonFormatter}).toString(CryptoJS.enc.Utf8);
                    }
                } catch (e) {
                    return false;
                }
            } else {
                return true;
            }
        },

        // Return a decrypted private key using the password
        getDecryptedPrivateKey: function (password) {
            if (isEncrypted) {
                if (typeof chrome !== 'undefined') {
                    var decryptedPrivateKey = CryptoJS.AES.decrypt(privateKey, password);
                } else {
                    var decryptedPrivateKey = CryptoJS.AES.decrypt(JSON.stringify(privateKey), password, {format:jsonFormatter});
                }
                try {
                    if (!decryptedPrivateKey.toString(CryptoJS.enc.Utf8)) {
                        return null;
                    }
                } catch (e) {
                    return null;
                }
                return decryptedPrivateKey.toString(CryptoJS.enc.Utf8);
            } else {
                return privateKey;
            }
        }

    };

    // Gets the current balance
    function updateBalance() {
        // Make sure we have an address
        if (address.length) {
            // Last stored balance is the fastest way to update
            preferences.getLastBalance().then(function (result) {
                balance = result;
                if (balanceListener) balanceListener(balance);
                // Check Auroracoin-node for the current balance
                //util.get('http://104.236.66.174:3333/chain/Auroracoin/q/addressbalance/' + address).then(function (response) {
                //    balance = response * 100000000; //to match SATOSHIS
                util.get('http://insight.auroracoin.is/api/addr/' + address + '/balance').then(function (response) {
                      balance = response ;
                    return preferences.setLastBalance(balance);
                }).then(function () {
                    if (balanceListener) balanceListener(balance);
                });
            });
        }
    }

    var ret = new wallet();

    // Change the password to a new password
    wallet.prototype.updatePassword = function (password, newPassword) {
        return new Promise(function (resolve, reject) {
            // Make sure the previous password is correct
            var decryptedPrivateKey = ret.getDecryptedPrivateKey(password);
            if (decryptedPrivateKey) {
                // If we have a new password we use it, otherwise leave cleartext
                if (newPassword) {
                    if (typeof chrome !== 'undefined') {
                        privateKey = CryptoJS.AES.encrypt(decryptedPrivateKey, newPassword);
                    } else {
                        privateKey = JSON.parse(CryptoJS.AES.encrypt(decryptedPrivateKey, newPassword, {format:jsonFormatter}));
                    }
                    isEncrypted = true;
                } else {
                    privateKey = decryptedPrivateKey;
                    isEncrypted = false;
                }
                // Save the encrypted private key
                // Passwords are never saved anywhere
                Promise.all([preferences.setIsEncrypted(isEncrypted), preferences.setPrivateKey(privateKey)]).then(resolve);
            } else {
                reject(Error('Incorrect password'));
            }
        });
    };

    // Send bitcoin from the wallet to another address
    wallet.prototype.send = function (sendAddress, amount, fee, password) {
        return new Promise(function (resolve, reject) {
            var decryptedPrivateKey = ret.getDecryptedPrivateKey(password);
            if (decryptedPrivateKey) {
                // Get all unspent outputs from Auroracoin-node to generate our inputs
                //util.getJSON('http://104.236.66.174:3333/unspent/' + address).then(function (json) {
                util.getJSON('http://insight.auroracoin.is/api/addr/' + address).then(function (json) {
                    
                    var inputs = json.unspent_outputs,
                        selectedOuts = [],
                        //prepare a key to sign the tx
                        eckey = bitcoin.ECKey.fromWIF(decryptedPrivateKey),
                        // Total cost is amount plus fee
                        txValue = Number(amount) + Number(fee),
                        availableValue = 0;
                    // Gather enough inputs so that their value is greater than or equal to the total cost
                    for (var i = 0; i < inputs.length; i++) {
                        selectedOuts.push(inputs[i]);
                        availableValue = availableValue + inputs[i].value;
                        if ((availableValue - txValue) >= 0) break;
                    }
                    // If there aren't enough unspent outputs to available then we can't send the transaction
                    if ((availableValue - txValue) < 0) {
                        reject(Error('Insufficient funds'));
                    } else {
                        // Create the transaction
                        var tx = new bitcoin.Transaction();
                        // Add all our unspent outputs to the transaction as the inputs
                        for (i = 0; i < selectedOuts.length; i++) {
                            tx.addInput(selectedOuts[i].tx_hash, selectedOuts[i].tx_output_n);
                        }
                        // Add the send address to the transaction as the output
                        tx.addOutput(sendAddress, amount);
                        // Add any leftover value to the transaction as an output pointing back to this wallet,
                        // minus the fee of course
                        changeValue = availableValue - txValue;
                        if (changeValue > 0) {
                            //change this to wallet's address
                            tx.addOutput(eckey.pub.getAddress().toString(), changeValue);
                        }                        
                        // Sign all the input hashes
                        for (i = 0; i < tx.ins.length; i++) {
                            //sign each input of the transaction appropriately
                            tx.sign(i, eckey);
                        }
                        // Push the transaction to Auroracoin-node
                        var txdata = tx.toHex();
                        //window.alert(txdata);
                        //util.get('http://104.236.66.174:3333/pushtx/' + txdata).then(function (response) {
                        util.get('http://insight.auroracoin.is/api/tx/send/' + txdata).then(function (response) {
                            
                            success = response;
                            preferences.setLastBalance(balance - amount - fee);
                            if (success == 200) resolve();
                            if (success == 500) reject(Error('Unknown error'));
                            // but don't set the balance since the the wallet will update when it relaods
                        });
                    }
                }, function () {
                    reject(Error('Unknown error'));
                });
            } else {
                reject(Error('Incorrect password'));
            }
        });
    };

    var jsonFormatter = {
        stringify: function (cipherParams) {
            // create json object with ciphertext
            var jsonObj = {
                ct: cipherParams.ciphertext.toString(CryptoJS.enc.Hex)
            };

            // optionally add iv and salt
            if (cipherParams.iv) {
                jsonObj.iv = cipherParams.iv.toString();
            }
            if (cipherParams.salt) {
                jsonObj.s = cipherParams.salt.toString();
            }

            // stringify json object
            return JSON.stringify(jsonObj);
        },

        parse: function (jsonStr) {
            // parse json string
            var jsonObj = JSON.parse(jsonStr);

            // extract ciphertext from json object, and create cipher params object
            var cipherParams = CryptoJS.lib.CipherParams.create({
                ciphertext: CryptoJS.enc.Hex.parse(jsonObj.ct)
            });

            // optionally extract iv and salt
            if (jsonObj.iv) {
                cipherParams.iv = CryptoJS.enc.Hex.parse(jsonObj.iv)
            }
            if (jsonObj.s) {
                cipherParams.salt = CryptoJS.enc.Hex.parse(jsonObj.s)
            }

            return cipherParams;
        }
    };

    window.wallet = ret;
})(window);
