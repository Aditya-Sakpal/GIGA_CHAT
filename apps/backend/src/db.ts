import mongoose from "mongoose";


const { NEXT_PUBLIC_MONGO_URL }: { NEXT_PUBLIC_MONGO_URL?: string | undefined } = process.env as { NEXT_PUBLIC_MONGO_URL?: string | undefined };

const connect = async () => {

    try {
        if (!NEXT_PUBLIC_MONGO_URL) {
            throw new Error("MongoDB URL is not defined.");
        }

        await mongoose.connect(NEXT_PUBLIC_MONGO_URL, {
            dbName:'GIGA-CHAT'
        });
    } catch (error) {
        throw new Error("Error connecting to Mongoose");
    }
};

export default connect;
