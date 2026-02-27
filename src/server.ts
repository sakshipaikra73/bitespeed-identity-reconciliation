import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import { prisma } from "./repositories/contact.repository";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

async function bootstrap(): Promise<void> {
    try {
        // Verify database connectivity before accepting traffic
        await prisma.$connect();
        console.log("✅ Database connected successfully");

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`   Environment : ${process.env.NODE_ENV ?? "development"}`);
            console.log(`   Health check: http://localhost:${PORT}/health`);
        });
    } catch (error) {
        console.error("❌ Failed to start server:", error);
        await prisma.$disconnect();
        process.exit(1);
    }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
    console.log("SIGTERM signal received — shutting down gracefully");
    await prisma.$disconnect();
    process.exit(0);
});

process.on("SIGINT", async () => {
    console.log("SIGINT signal received — shutting down gracefully");
    await prisma.$disconnect();
    process.exit(0);
});

bootstrap();
