export interface GitHubPR {
    owner: string;
    repo: string;
    number: number;
    title: string;
    state: "open" | "closed" | "merged";
    draft: boolean;
    author: string;
    base: string;
    head: string;
    labels: string[];
    changedFiles: number;
    additions: number;
    deletions: number;
    comments: number;
    createdAt: string;
    updatedAt: string;
    url: string;
}
