import dotenv from 'dotenv';
import { DEV_BUILD } from './config.js';
import { ensureEnvFile } from './env.js';
import { ensureSelfSignedCertificate } from './generateCert.js';
import { doesMemberOfUsernameExist } from '../database/controllers/memberController.js';
import { generateAccount } from '../database/controllers/createaccountController.js';
import { giveRole } from '../database/controllers/roles.js';

function initDevEnvironment() {
	if (!DEV_BUILD) return callDotenvConfig(); // Production
    
	ensureEnvFile();
	callDotenvConfig();

	if (ensureSelfSignedCertificate()) { 
		// Let's also display the url to the page!
		// console.log(`Website is hosted at https://localhost:${process.env.HTTPSPORT_LOCAL}/`);
	}
	createDevelopmentAccounts();
}

function callDotenvConfig() {
	// Load the .env file contents into process.env
	// This needs to be as early as possible
	dotenv.config(); 
}

async function createDevelopmentAccounts() {
	if (!doesMemberOfUsernameExist("owner")) {
		const user_id = await generateAccount({ username: "Owner", email: "email1", password: "1", autoVerify: true });
		giveRole(user_id, "owner");
	}
	if (!doesMemberOfUsernameExist("patron")) {
		const user_id = await generateAccount({ username: "Patron", email: "email2", password: "1", autoVerify: true });
		giveRole(user_id, "patron");
	}
	if (!doesMemberOfUsernameExist("member")) {
		const user_id = await generateAccount({ username: "Member", email: "email3", password: "1", autoVerify: true });
	}
	// generateAccount({ username: "Member23", email: "email@teste3mail.com", password: "1", autoVerify: false });
}


export {
	initDevEnvironment
};
