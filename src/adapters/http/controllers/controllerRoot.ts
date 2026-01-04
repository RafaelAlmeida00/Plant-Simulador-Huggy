import express from 'express';

class ControllerRoot {
    constructor() {
    }
    handle(req: express.Request, res: express.Response) {
        res.send('Welcome to the Root Controller!');
    }
}
export default new ControllerRoot()
