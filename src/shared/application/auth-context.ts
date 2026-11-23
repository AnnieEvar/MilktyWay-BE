export interface AuthContext {
  sessionId: string;
  subjectId: string;
  kind: "STAFF" | "CUSTOMER";
}
