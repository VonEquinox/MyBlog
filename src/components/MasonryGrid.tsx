import React from 'react';
import { motion } from 'framer-motion';

export interface Post {
  id: string;
  data: {
    title: string;
    description?: string;
    date: Date;
    tags?: string[];
  };
}

export default function MasonryGrid({ posts }: { posts: Post[] }) {
  // Simple CSS masonry using columns
  return (
    <div className="columns-1 sm:columns-2 lg:columns-3 gap-6 space-y-6">
      {posts.map((post, index) => (
        <motion.div
          key={post.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: index * 0.1, ease: 'easeOut' }}
          className="break-inside-avoid"
        >
          <a href={`/blog/${post.id}`} className="block group">
            <div className="bg-surface text-on-surface rounded-2xl p-6 shadow-sm border border-outline/20 hover:shadow-md hover:border-primary/30 transition-all duration-300 flex flex-col gap-4 relative overflow-hidden h-full">
              {/* MD3 State layer effect on hover */}
              <div className="absolute inset-0 bg-on-surface opacity-0 group-hover:opacity-[0.04] transition-opacity pointer-events-none" />
              
              <div className="flex flex-col gap-2">
                <h3 className="text-xl font-medium leading-tight group-hover:text-primary transition-colors">
                  {post.data.title}
                </h3>
                <time className="text-xs text-on-surface-variant font-medium">
                  {new Date(post.data.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                  })}
                </time>
              </div>
              
              {post.data.description && (
                <p className="text-on-surface-variant text-sm leading-relaxed">
                  {post.data.description}
                </p>
              )}

              {post.data.tags && post.data.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-auto pt-2">
                  {post.data.tags.map(tag => (
                    <span 
                      key={tag} 
                      className="px-3 py-1 bg-secondary/10 text-secondary rounded-lg text-xs font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </a>
        </motion.div>
      ))}
    </div>
  );
}
