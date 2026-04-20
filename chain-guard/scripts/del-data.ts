import { client } from "../src/db/setup";
import promptSync from "prompt-sync";


const prompt = promptSync();

const run = async () => {
    try {
        await client.execute("DELETE FROM reports");
        await client.execute("DELETE FROM upi_status");

        console.log("DB cleared successfully!")
    } catch(e) {
        console.error("There was an error while clearing the db.");
        console.log("Error:", e);
    }
}


console.log("This script will delete all data in reports.db");

const userChoice = prompt("Are you sure? (y/n)").toLowerCase();

if(userChoice == 'y') {
    run();
} else {
    console.log("Then why did you run this script bruh 🥲");
}