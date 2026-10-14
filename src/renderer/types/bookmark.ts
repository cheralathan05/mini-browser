export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  folderId?: string | null;
  createdAt: number;
}
