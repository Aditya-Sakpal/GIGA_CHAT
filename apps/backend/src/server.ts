import express, { Request, Response } from 'express';
import cors from 'cors';

const app = express();
const port = 4000;
app.use(express.json())
app.use(cors())

app.get('/', async (req: Request, res: Response) => {
  res.send('Hello, TypeScript!');
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
