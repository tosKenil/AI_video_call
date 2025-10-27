const MongoClient = require('mongodb').MongoClient;
const { EJSON } = require("bson"); // <-- Important
const fs = require('fs');


const exportDatabase = async function (connectionUrl, outputFile) {
    const client = new MongoClient(connectionUrl, { useUnifiedTopology: true });

    try {
        // Connect to MongoDB
        await client.connect();

        const dbName = new URL(connectionUrl).pathname.replace(/^\//, "");
        const db = client.db(dbName);
        const collections = await db.listCollections().toArray();

        let exportData = {};

        // Loop through collections
        for (let collectionInfo of collections) {
            const collectionName = collectionInfo.name;
            const collection = db.collection(collectionName);

            // Extract schema (from one sample doc)
            const sampleDocument = await collection.findOne();
            const schema = {};
            if (sampleDocument) {
                for (let key in sampleDocument) {
                    schema[key] = typeof sampleDocument[key];
                }
            }

            // Extract data
            const data = await collection.find().toArray();

            // Add schema and data to exportData
            exportData[collectionName] = {
                schema: schema,
                data: data
            };
        }

        // Write export data using EJSON.stringify to preserve ObjectId/Date
        fs.writeFileSync(outputFile, EJSON.stringify(exportData, null, 4));
        console.log("✅ Export completed successfully.");

    } catch (err) {
        console.error("❌ Error exporting MongoDB schema:", err);
    } finally {
        await client.close();
    }
};

// exportDatabase('mongodb+srv://it:kNjaldeHTqNWfP8e@cluster0.4ggbjja.mongodb.net/corpsec?retryWrites=true&w=majority', 'export.json');


const importDatabase = async function (connectionUrl, dbName, inputFile) {
    const client = new MongoClient(connectionUrl, { useUnifiedTopology: true });

    try {
        // Connect to MongoDB
        await client.connect();

        const db = client.db(dbName);

        // Read JSON data using EJSON.parse (to restore ObjectIds/Dates)
        const fileContent = fs.readFileSync(inputFile, "utf8");
        const jsonData = EJSON.parse(fileContent);

        // Loop through collections in the JSON data
        for (let collectionName in jsonData) {
            const collectionData = jsonData[collectionName];
            const collection = db.collection(collectionName);

            // Drop existing collection if it exists (to avoid duplicate _id errors)
            const collections = await db.listCollections({ name: collectionName }).toArray();
            if (collections.length > 0) {
                await collection.drop();
            }

            // Recreate and insert data
            if (collectionData.data && collectionData.data.length > 0) {
                await db.createCollection(collectionName);
                await collection.insertMany(collectionData.data);
            }
        }

        console.log("✅ Data imported successfully.");
    } catch (err) {
        console.error("❌ Error importing data to MongoDB:", err);
    } finally {
        await client.close();
    }
};

// importDatabase('mongodb://localhost:27017/', 'coresecBackup_14-10-2025', 'export.json');