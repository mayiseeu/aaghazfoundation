const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const sequelize = require("./config/db");
// Import routes (to be created)
const authRoutes = require("./routes/authRoutes");
const blogRoutes = require("./routes/blogRoutes");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  "https://elegantize.com",
  "https://elegantize.com/",
  "https://www.elegantize.com",
  "https://www.elegantize.com/",
  "http://localhost:5173",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    optionsSuccessStatus: 200,
  }),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/blogs", blogRoutes);

// Database Connection and Sync
sequelize
  .authenticate()
  .then(async () => {
    console.log("MySQL Database Connected...");

    // Fix id column type
    await sequelize.query(
      "ALTER TABLE BlogPosts MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT"
    ).catch((err) => console.log("ALTER id warning:", err.message));

    // Drop duplicate slug unique indexes (sync alter adds a new one every restart)
    const [indexes] = await sequelize.query(
      "SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_NAME='BlogPosts' AND TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='slug' AND INDEX_NAME != 'PRIMARY'"
    ).catch(() => [[]]);
    const indexNames = indexes.map((r) => r.INDEX_NAME);
    // Keep one, drop the rest
    for (let i = 1; i < indexNames.length; i++) {
      await sequelize.query(
        `ALTER TABLE \`BlogPosts\` DROP INDEX \`${indexNames[i]}\``
      ).catch((err) => console.log(`DROP INDEX warning: ${err.message}`));
    }
    if (indexNames.length > 1) {
      console.log(`Cleaned up ${indexNames.length - 1} duplicate slug indexes`);
    }

    // Use sync without alter to prevent duplicate index buildup
    await sequelize.sync();
    console.log("Database Synced");
  })
  .catch((err) => console.log("Error: " + err));

// Serve static assets in production
if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging") {
  // Check if dist folder exists (it won't on Render if only deploying backend)
  const distPath = path.join(__dirname, "dist");

  if (fs.existsSync(distPath)) {
    // Set static folder
    app.use(express.static(distPath));

    // Any other route that isn't an API route should be handled by the React app
    app.get(/(.*)/, (req, res) => {
      // Check if the request is for an API endpoint to avoid returning HTML for 404 API calls
      if (req.path.startsWith("/api")) {
        return res.status(404).json({ message: "API Endpoint not found" });
      }

      // Check if dist/index.html exists before sending it
      const indexPath = path.resolve(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(500).send("Frontend build found but index.html is missing.");
      }
    });
  } else {
    // API-Only Mode (e.g. Render Backend)
    app.get("/", (req, res) => {
      res.send("Elegantize Backend API Running (No Frontend Build Found)");
    });
  }
} else {
  app.get("/", (req, res) => {
    res.send("Elegantize Backend Running (Dev Mode)");
  });
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
