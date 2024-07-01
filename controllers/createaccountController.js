
/*
 * This module handles create account form data,
 * verifying the data, creating the account,
 * and sending them a verification email.
 * 
 * It also answers requests for whether or not
 * a specific username or email is available.
 */

const bcrypt = require('bcrypt');

const { handleLogin } = require('./authController')
const { sendEmailConfirmation } = require('./sendMail')
const { addMember, getMemberData, constructEmailHash, doesMemberExist } = require('./members.js')
const { logEvents } = require('../middleware/logEvents');
const { isEmailBanned } = require('../middleware/banned')

const emailHash = constructEmailHash();

const reservedUsernames = [
    'infinitechess'
];
/** Any username cannot contain these words */
const profainWords = [
    'fuck',
    'fuk',
    'shit',
    'piss',
    // 'ass', // Can't enable because "pass" wouldn't be allowed.
    'penis',
    'bitch',
    'bastard',
    'cunt',
    'penis',
    'vagina',
    'boob',
    'nigger',
    'niger',
    'pussy',
    'buthole',
    'butthole',
    'ohmygod',
    'poop'
];

// Called when create account form submitted
const createNewMember = async (req, res) => {
    if (!req.body) {
        console.log(`User sent a bad create account request missing the whole body!`)
        return res.status(400).send('Bad Request'); // 400 Bad request
    }
    // First make sure we have all 3 variables.
    let { username, email, password } = req.body;
    if (!username || !email || !password) {
        console.error('We received request to create new member without all supplied username, email, and password!')
        return res.status(400).redirect('/400') // Bad request
    }

    // Make the email lowercase so we don't run into problems with seeing if capitalized emails are taken!
    email = email.toLowerCase();

    // First we make checks on the username...
    // These 'return's are so that we don't send duplicate responses, AND so we don't create the member anyway.
    if (doUsernameFormatChecks(username, res) !== true) return;
    if (doEmailFormatChecks(email, res) !== true) return;
    if (doPasswordFormatChecks(password, res) !== true) return;

    await generateAccount({ username, email, password })

    // SEND EMAIL CONFIRMATION
    const memberData = getMemberData(username)
    sendEmailConfirmation(memberData);

    // GENERATE ACCESS AND REFRESH TOKENS! They just created an account, so log them in!
    // This will handle our response/redirect
    handleLogin(req, res);
}

/**
 * Generate an account only from the provided username, email, and password.
 * Regex tests are skipped.
 * @param {Object} param0 - The object containing account information.
 * @param {string} param0.username - The username for the new account.
 * @param {string} param0.email - The email for the new account.
 * @param {string} param0.password - The password for the new account.
 * @param {boolean} param0.autoVerify - Whether or not to auto-verify this account.
 */
async function generateAccount({ username, email, password, autoVerify }) {
    const usernameLowercase = username.toLowerCase();

    // Update email list!
    emailHash[email] = true;

    // Use bcrypt to hash & salt password
    const hashedPassword = await bcrypt.hash(password, 10); // Passes 10 salt rounds. (standard)
    const date = new Date();

    const newMember = {
        username,
        email,
        password: hashedPassword,
        refreshTokens: [],
        joined: date,
        logins: 0,
        seen: date,
        elo: 1200,
        // , bio: ''
    };
    if (!autoVerify) newMember.verified = [false, generateID(24)]
    
    // Without 'await' this returns a promise.
    const success = addMember(usernameLowercase, newMember)
    if (!success) return res.status(500).redirect('/500') // Server error (username already exists)
    
    const logTxt = `Created new member: ${newMember.username}`
    logEvents(logTxt, 'newMemberLog.txt', { print: true });
}

// This function returns info for creating an account.
// Requested by a fetch in script in createaccount page.
// In the future we can use our HTMLScriptInjector to insert it
// into the createaccount html instead.
function getRegisterData(req, res) {
    res.json({
        reservedUsernames,
        profainWords
    });
}

/**
 * Generates a random string of the specified length,
 * containing number 0-9 and letters a-z.
 * @param {number} length - The length of the desired random string
 * @returns {string} The random ID
 */
const generateID = function (length) {
    let result = '';
    const characters = '0123456789abcdefghijklmnopqrstuvwxyz';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.random() * charactersLength);
    }
    return result;
}

// Route
// Returns whether the email parameter is associated with an account. Called from inside the createaccount script.
// True = open. false = in-use
const checkEmailAssociated = (req, res) => {
    if (isEmailAvailable(req.params.email.toLowerCase())) res.json([true]);
    else res.json([false]);
}

const isEmailAvailable = function (email) {
    if (emailHash[email]) return false;
    return true;
}

// Route
// Returns true if username is available
const checkUsernameAssociated = (req, res) => {
    if (isUsernameAvailable(req.params.username.toLowerCase())) return res.json([true]);
    else return res.json([false]);
}

const isUsernameAvailable = function (string) { // string is in lowercase
    return !doesMemberExist(string);
}

const doUsernameFormatChecks = function (username, res) {
    // First we check the username's length
    if (username.length < 3 || username.length > 20) return res.status(400).json({ 'message': 'Username must be between 3-20 characters'});
    // Then the format
    if (!onlyLettersAndNumbers(username)) return res.status(400).json({ 'message': 'Username must only contain letters A-Z and numbers 0-9'});
    // Then check if the name's taken
    const usernameLowercase = username.toLowerCase();

    // Make sure the username isn't taken!!

    if (doesMemberExist(usernameLowercase)) return res.status(409).json({ 'conflict': 'That username is taken'});
    
    // Then check if the name's reserved
    if (reservedUsernames.indexOf(usernameLowercase) !== -1) return res.status(409).json({ 'conflict': 'That username is reserved'});
    // Lastly check for profain words
    if (checkProfanity(usernameLowercase)) return res.status(409).json({ 'conflict': 'That username contains a word that is not allowed'});
    return true; // Everything's good, no conflicts!
}

const onlyLettersAndNumbers = function (string) {
    if (!string) return true;
    return /^[a-zA-Z0-9]+$/.test(string);
}

// Returns true if bad word is found
const checkProfanity = function (string) {
    for (let i = 0; i < profainWords.length; i++) {
        profanity = profainWords[i];
        if (string.includes(profanity)) return true;
    }
    return false;
}

const doEmailFormatChecks = function (string, res) {
    console.log();
    if (!isValidEmail(string)) return res.status(400).json({ 'message': 'This is not a valid email'});
    if(!isEmailAvailable(string.toLowerCase())) return res.status(409).json({ 'conflict': 'This email is already in use'});
    if (isEmailBanned(string)) {
        console.log(`Banned user with email ${string.toLowerCase()} tried to recreate their account!`)
        return res.status(409).json({ 'conflict': 'You are banned.'});
    }
    return true;
}

const isValidEmail = function (string) {
    const regex = /^([a-zA-Z0-9\._]+)@([a-zA-Z0-9])+.([a-z]+)(.[a-z]+)?$/;
    return regex.test(string);
}

const doPasswordFormatChecks = function (password, res) {
    // First we check password length
    if (password.length < 6 || password.length > 30) return res.status(400).json({ 'message': 'Password must be between 6-30 characters long'});
    if (!isValidPassword(password)) return res.status(400).json({ 'message': 'Password is in an incorrect format'});
    if (password.toLowerCase() === 'password') return res.status(400).json({ 'message': "Password must not be 'password'"});
    return true;
}

const isValidPassword = function (string) {
    const regex = /^[a-zA-Z0-9!@#$%^&*\?]+$/;
    if (regex.test(string) === true) return true;
    return false;
}

module.exports = {
    createNewMember,
    getRegisterData,
    checkEmailAssociated,
    checkUsernameAssociated,
    generateID,
    generateAccount
};