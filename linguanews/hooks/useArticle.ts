import { useArticleStore } from '../store/articleStore';
import { UserSettings } from '../types';
import { CostSource } from '../services/apiCosts';

export function useArticle() {
  const { loadArticle, isLoading, loadingStep, error, currentArticle, clearError } =
    useArticleStore();

  async function fetchArticle(input: string, isUrl: boolean, settings: UserSettings, source: CostSource = 'article') {
    clearError();
    await loadArticle(input, isUrl, settings, source);
  }

  return { fetchArticle, isLoading, loadingStep, error, currentArticle };
}
