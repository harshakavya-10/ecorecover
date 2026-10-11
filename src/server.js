import { app } from './app.js';
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`EcoRecover AI running on http://localhost:${port} (classifier: ${process.env.CLASSIFIER || 'demo'})`));
