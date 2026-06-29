import { useArticleStore } from '../store/articleStore';
import { UserSettings } from '../types';

export function useArticle() {
  const { loadArticle, isLoading, loadingStep, error, currentArticle, clearError } =
    useArticleStore();

  async function fetchArticle(input: string, isUrl: boolean, settings: UserSettings) {
    clearError();
    await loadArticle(input, isUrl, settings);
  }

  return { fetchArticle, isLoading, loadingStep, error, currentArticle };
}
