declare global {
    namespace Express {
        interface Request {
            userId?: number;
            organizationId?: number;
        }
    }
}

export { };