// server.js
// require('dotenv').config();
// Import necessary modules
const express = require('express'); // Express.js for building the web server
const cors = require('cors'); // CORS for handling cross-origin requests
const sqlite3 = require('sqlite3').verbose(); // SQLite3 for in-memory database operations
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Google Gemini API client

// Initialize Express app
const app = express();
const port = process.env.PORT || 3001; // Use the provided port or default to 3001

// Middleware
app.use(cors()); // Enable CORS for all routes, allowing frontend to make requests
const allowedOrigins = [
  https://sqlchatbotnew.netlify.app/, // your deployed frontend
  'http://localhost:5173',             // local dev
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json()); // Enable parsing of JSON request bodies

// Configure Gemini API
// IMPORTANT: Replace 'YOUR_GEMINI_API_KEY' with your actual Gemini API key.
// For security, consider using environment variables (e.g., process.env.GEMINI_API_KEY)
// in a production environment.
const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

// Endpoint to generate SQL query, CREATE TABLE statement, and INSERT statements
app.post('/api/generate-sql', async (req, res) => {
  console.log('Received request to /api/generate-sql'); // Added logging
  const { prompt } = req.body; // Get the natural language prompt from the request body

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  try {
    // Select the model for text generation
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Construct the prompt for Gemini to generate SQL, schema, and sample data
    const geminiPrompt = `
      Given the following natural language request, generate:
      1. A SQLite SQL SELECT query that answers the request.
      2. A SQLite CREATE TABLE statement for a table that would contain relevant data for this query.
      3. At least 5 SQLite INSERT INTO statements to populate the table with sample data.
      
      Ensure the table name and column names in the SELECT query match the CREATE TABLE statement.
      The output should be in a JSON format with three keys: "sqlQuery", "createTableSql", and "insertDataSql".
      "insertDataSql" should be an array of strings, where each string is an INSERT INTO statement.

      Natural language request: "${prompt}"

      Example JSON output structure:
      {
        "sqlQuery": "SELECT name, age FROM students WHERE age > 20;",
        "createTableSql": "CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, age INTEGER, major TEXT);",
        "insertDataSql": [
          "INSERT INTO students (id, name, age, major) VALUES (1, 'Alice', 22, 'Computer Science');",
          "INSERT INTO students (id, name, age, major) VALUES (2, 'Bob', 19, 'Physics');",
          "INSERT INTO students (id, name, age, major) VALUES (3, 'Charlie', 25, 'Mathematics');",
          "INSERT INTO students (id, name, age, major) VALUES (4, 'Diana', 21, 'Biology');",
          "INSERT INTO students (id, name, age, major) VALUES (5, 'Eve', 23, 'Chemistry');"
        ]
      }
    `;

    console.log('Sending prompt to Gemini API...'); // Added logging
    // Generate content using the Gemini API
    const result = await model.generateContent(geminiPrompt);
    const response = await result.response;
    const text = response.text(); // Get the plain text response from Gemini
    console.log('Received response from Gemini API.'); // Added logging

    // Attempt to parse the JSON response from Gemini
    let parsedResponse;
    try {
      // Remove Markdown code block if present
      let cleanedText = text.trim();
      if (cleanedText.startsWith('```')) {
        // Remove the first line (```json or ```)
        cleanedText = cleanedText.replace(/^```[a-z]*\n?/i, '');
        // Remove the last line if it's ```
        cleanedText = cleanedText.replace(/\n?```$/, '');
      }
      parsedResponse = JSON.parse(cleanedText);
      console.log('Successfully parsed Gemini response.'); // Added logging
    } catch (parseError) {
      console.error('Failed to parse Gemini response as JSON:', text);
      return res.status(500).json({ error: 'Failed to parse Gemini response. It might not be valid JSON.' });
    }

    // Extract the generated SQL query, CREATE TABLE, and INSERT statements
    const { sqlQuery, createTableSql, insertDataSql } = parsedResponse;

    // Send the generated SQL, schema, and data back to the frontend
    res.json({ sqlQuery, createTableSql, insertDataSql });

  } catch (error) {
    console.error('Error generating SQL with Gemini API:', error);
    res.status(500).json({ error: 'Failed to generate SQL. Please try again.' });
  }
});

// Endpoint to execute the generated SQL query against an in-memory SQLite database
app.post('/api/execute-sql', async (req, res) => {
  console.log('Received request to /api/execute-sql'); // Added logging
  const { sqlQuery, createTableSql, insertDataSql } = req.body; // Get SQL components from request body

  if (!sqlQuery || !createTableSql || !insertDataSql || !Array.isArray(insertDataSql)) {
    return res.status(400).json({ error: 'SQL query, CREATE TABLE statement, and INSERT data are required.' });
  }

  // Create an in-memory SQLite database
  const db = new sqlite3.Database(':memory:', (err) => {
    if (err) {
      console.error('Error opening database:', err.message);
      return res.status(500).json({ error: 'Failed to initialize database.' });
    }
    console.log('Connected to the in-memory SQLite database.');
  });

  try {
    // Run CREATE TABLE statement
    await new Promise((resolve, reject) => {
      db.run(createTableSql, (err) => {
        if (err) {
          console.error('Error creating table:', err.message);
          return reject(new Error(`Failed to create table: ${err.message}`));
        }
        console.log('Table created successfully.');
        resolve();
      });
    });

    // Run all INSERT INTO statements
    for (const insertStmt of insertDataSql) {
      await new Promise((resolve, reject) => {
        db.run(insertStmt, (err) => {
          if (err) {
            console.error('Error inserting data:', err.message);
            return reject(new Error(`Failed to insert data: ${err.message}`));
          }
          resolve();
        });
      });
    }
    console.log('Sample data inserted successfully.');

    // Run the main SQL query and fetch results
    db.all(sqlQuery, [], (err, rows) => {
      if (err) {
        console.error('Error executing query:', err.message);
        return res.status(500).json({ error: `Failed to execute query: ${err.message}` });
      }
      console.log('Query executed successfully. Results:', rows);
      res.json({ results: rows }); // Send query results back to frontend
    });

  } catch (error) {
    console.error('Database operation error:', error);
    res.status(500).json({ error: error.message || 'An unexpected error occurred during database operations.' });
  } finally {
    // Close the database connection after all operations are done
    // For a real application, you might manage connections differently.
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err.message);
      }
      console.log('Closed the database connection.');
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
});
